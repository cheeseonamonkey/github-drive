import { useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ChevronRight, File, FileText, Folder, FolderPlus,
  GitBranch, Image as ImageIcon, LogOut, Pencil, RefreshCw, Search, ShieldCheck,
  Trash2, Upload, X,
} from 'lucide-react';
import { encodePath, Entry, GitHubDrive, MAX_UPLOAD_BYTES, RepoDetails } from './github';

type Connection = { api: GitHubDrive; repo: RepoDetails };
type Preview = { kind: 'loading' | 'text' | 'image' | 'other' | 'error'; value?: string };

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition hover:opacity-85';
const secondary = button + ' border border-line bg-white text-ink';
const primary = button + ' bg-accent text-white';
const textFile = /\.(?:txt|md|markdown|csv|json|jsonl|yml|yaml|xml|toml|ini|log|js|jsx|ts|tsx|css|scss|html|py|rs|go|sh|java|kt|sql|svg)$/i;
const imageFile = /\.(?:png|jpg|jpeg|webp|gif|bmp|avif)$/i;

function readableSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 ** 2) return (bytes / 1024).toFixed(1) + ' KiB';
  return (bytes / 1024 ** 2).toFixed(1) + ' MiB';
}

function validName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !/[\\/\x00-\x1f]/.test(name);
}

function ItemIcon({ item }: { item: Entry }) {
  if (item.type === 'dir') return <Folder className="shrink-0 text-accent" size={22} />;
  if (imageFile.test(item.name)) return <ImageIcon className="shrink-0 text-muted" size={22} />;
  if (textFile.test(item.name)) return <FileText className="shrink-0 text-muted" size={22} />;
  return <File className="shrink-0 text-muted" size={22} />;
}

export default function App() {
  const [repository, setRepository] = useState('');
  const [token, setToken] = useState('');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [path, setPath] = useState('');
  const [items, setItems] = useState<Entry[]>([]);
  const [filter, setFilter] = useState('');
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Entry | null>(null);
  const [preview, setPreview] = useState<Preview>({ kind: 'other' });
  const uploadRef = useRef<HTMLInputElement>(null);

  function refresh() {
    setVersion((value) => value + 1);
  }

  async function perform(label: string, job: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      await job();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy('');
    }
  }

  useEffect(() => {
    if (!connection) return;
    let active = true;
    setLoading(true);
    setError('');
    connection.api.list(path, connection.repo.default_branch)
      .then((entries) => { if (active) setItems(entries); })
      .catch((reason: unknown) => {
        if (active) {
          setItems([]);
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [connection, path, version]);

  useEffect(() => {
    if (!selected || !connection) return;
    setPreview({ kind: 'loading' });

    const isImage = imageFile.test(selected.name);
    const isText = textFile.test(selected.name) && !/\.svg$/i.test(selected.name);
    if (selected.size > MAX_UPLOAD_BYTES || (!isImage && !isText)) {
      setPreview({ kind: 'other' });
      return;
    }

    let active = true;
    let objectUrl: string | undefined;
    connection.api.read(selected.path, connection.repo.default_branch)
      .then(async (blob) => {
        if (!active) return;
        if (isImage) {
          objectUrl = URL.createObjectURL(blob);
          setPreview({ kind: 'image', value: objectUrl });
        } else {
          const content = await blob.text();
          if (active) setPreview({ kind: 'text', value: content.slice(0, 250_000) });
        }
      })
      .catch((reason: unknown) => {
        if (active) setPreview({ kind: 'error', value: String(reason) });
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [connection, selected]);

  async function connect() {
    await perform('Connecting', async () => {
      const api = new GitHubDrive(token.trim(), repository.trim());
      const repo = await api.details();
      await api.list('', repo.default_branch);
      setConnection({ api, repo });
      setToken('');
      setPath('');
    });
  }

  function open(item: Entry) {
    if (item.type === 'dir') {
      setFilter('');
      setPath(item.path);
    } else if (item.type === 'file') {
      setSelected(item);
    }
  }

  function upload(files: File[]) {
    if (!connection || files.length === 0) return;
    void perform('Uploading', async () => {
      try {
        for (const file of files) {
          if (!validName(file.name)) throw new Error('Invalid filename: ' + file.name);
          if (file.size > MAX_UPLOAD_BYTES) throw new Error(file.name + ' is over the 10 MiB limit.');
          const existing = items.find((item) => item.name === file.name);
          if (existing?.type === 'dir') throw new Error('A folder already uses the name ' + file.name);
          if (existing && !window.confirm('Replace ' + file.name + '?')) continue;
          const target = [path, file.name].filter(Boolean).join('/');
          await connection.api.write(target, new Uint8Array(await file.arrayBuffer()), existing?.sha);
        }
      } finally {
        refresh();
      }
    });
  }

  function addFolder() {
    if (!connection) return;
    const name = window.prompt('Folder name')?.trim();
    if (name == null) return;
    if (!validName(name)) { setError('Choose a valid folder name.'); return; }
    if (items.some((item) => item.name === name)) { setError('That name already exists.'); return; }
    void perform('Creating folder', async () => {
      const marker = [path, name, '.gitkeep'].filter(Boolean).join('/');
      await connection.api.write(marker, new Uint8Array());
      refresh();
    });
  }

  function removeEmptyFolder() {
    if (!connection || !path || !window.confirm('Remove this empty folder?')) return;
    void perform('Deleting folder', async () => {
      await connection.api.deleteEmptyFolder(path, connection.repo.default_branch);
      setPath(path.split('/').slice(0, -1).join('/'));
      refresh();
    });
  }

  function remove(item: Entry) {
    if (!connection || !window.confirm('Delete ' + item.name + '? Git history will retain old versions.')) return;
    void perform('Deleting', async () => {
      await connection.api.delete(item.path, item.sha);
      setSelected(null);
      refresh();
    });
  }

  function rename(item: Entry) {
    if (!connection) return;
    const newName = window.prompt('New filename', item.name)?.trim();
    if (newName == null || newName === item.name) return;
    if (!validName(newName)) { setError('Choose a valid filename.'); return; }
    if (items.some((other) => other.name === newName)) { setError('That name already exists.'); return; }
    if (item.size > MAX_UPLOAD_BYTES) { setError('Cannot rename files over 10 MiB.'); return; }
    void perform('Renaming', async () => {
      const newPath = [path, newName].filter(Boolean).join('/');
      const blob = await connection.api.read(item.path, connection.repo.default_branch);
      await connection.api.write(newPath, new Uint8Array(await blob.arrayBuffer()));
      try {
        await connection.api.delete(item.path, item.sha);
      } catch (reason) {
        refresh();
        throw new Error('The new file was created, but removing the old one failed. Both may exist. ' + String(reason));
      }
      setSelected(null);
      refresh();
    });
  }

  function download(item: Entry) {
    if (!connection) return;
    void perform('Downloading', async () => {
      const blob = await connection.api.read(item.path, connection.repo.default_branch);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = item.name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    });
  }

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selected]);

  const segments = path ? path.split('/') : [];
  const shown = items.filter((item) => item.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex min-h-17 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-accent/10 p-2.5 text-accent"><Folder size={22} /></div>
            <div>
              <h1 className="font-semibold tracking-tight">RepoDrive</h1>
              <p className="text-xs text-muted">A tiny file cabinet, backed by GitHub.</p>
            </div>
          </div>
          {connection && (
            <button className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-muted hover:text-ink" onClick={() => {
              setConnection(null); setItems([]); setSelected(null); setError(''); setPath('');
            }}>
              <LogOut size={17} /> <span className="hidden sm:inline">Disconnect</span>
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20 pt-7 sm:px-6 sm:pt-10">
        {!connection ? (
          <section className="mx-auto max-w-lg">
            <p className="mb-2 text-sm font-medium text-accent">Your files, your repository.</p>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">A simpler place for files.</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              Browse and manage a GitHub repository like a drive. Your access token stays in this tab
              and is never saved to the site.
            </p>
            <form className="mt-8 space-y-5 rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-7" onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}>
              <label className="block space-y-2">
                <span className="text-sm font-medium">Storage repository</span>
                <input className="min-h-12 w-full rounded-xl border border-line px-3.5 text-sm outline-none"
                  placeholder="yourname/private-files" required value={repository}
                  onChange={(event) => setRepository(event.target.value)} autoComplete="off" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-medium">Fine-grained access token</span>
                <input className="min-h-12 w-full rounded-xl border border-line px-3.5 text-sm outline-none"
                  type="password" placeholder="github_pat_..." required value={token}
                  onChange={(event) => setToken(event.target.value)} autoComplete="off" />
              </label>
              <p className="text-xs leading-5 text-muted">
                Grant <strong>Contents: read and write</strong> on just the storage repository.
                Never use a broad-scope personal token here.{' '}
                <a className="text-accent underline underline-offset-2" href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank" rel="noopener noreferrer">Create token</a>
              </p>
              <button className={primary + ' w-full'} disabled={!!busy} type="submit">
                <ShieldCheck size={17} /> {busy || 'Connect to repository'}
              </button>
            </form>
            <p className="mt-5 text-xs leading-5 text-muted">
              Keep this website public and your storage in a separate private repository.
              Refreshing the page disconnects you.
            </p>
          </section>
        ) : (
          <section>
            <div className="mb-7 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-accent">
                  {connection.repo.private ? 'Private repository' : 'Public repository'}
                </p>
                <h2 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
                  {connection.repo.full_name}
                </h2>
                <p className="mt-1 text-xs text-muted">Branch: {connection.repo.default_branch} · Files are versioned in Git</p>
              </div>
              <button className={secondary + ' self-start'} onClick={() => refresh()} disabled={!!busy} title="Refresh files">
                <RefreshCw size={17} /> Refresh
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
              <div className="flex min-h-14 flex-wrap items-center gap-1 border-b border-line px-3 py-2 sm:px-5">
                <button className="min-h-10 rounded-lg px-2 text-sm font-medium text-accent hover:bg-paper"
                  onClick={() => { setPath(''); setFilter(''); }}>Files</button>
                {segments.map((segment, index) => (
                  <div className="flex min-w-0 items-center" key={index}>
                    <ChevronRight size={14} className="shrink-0 text-muted" />
                    <button className="max-w-40 truncate rounded-lg px-2 py-2 text-sm hover:bg-paper"
                      onClick={() => { setPath(segments.slice(0, index + 1).join('/')); setFilter(''); }}>
                      {segment}
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 border-b border-line p-3 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 sm:max-w-xs sm:flex-1">
                  <Search size={17} className="text-muted" />
                  <input className="w-full bg-transparent text-sm outline-none" placeholder="Filter this folder"
                    value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter filenames" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button className={secondary} onClick={addFolder} disabled={!!busy}>
                    <FolderPlus size={18} /> New folder
                  </button>
                  <button className={primary} onClick={() => uploadRef.current?.click()} disabled={!!busy}>
                    <Upload size={18} /> Upload
                  </button>
                  <input ref={uploadRef} className="hidden" type="file" multiple aria-label="Upload files"
                    onChange={(event) => {
                      const files = Array.from(event.currentTarget.files || []);
                      event.currentTarget.value = '';
                      upload(files);
                    }} />
                </div>
              </div>

              {loading ? (
                <div className="px-5 py-16 text-center text-sm text-muted">Loading files…</div>
              ) : shown.length === 0 ? (
                <div className="px-5 py-16 text-center">
                  <Folder size={32} className="mx-auto mb-3 text-accent/50" />
                  <p className="text-sm font-medium">{filter ? 'No matching files' : 'This folder is empty'}</p>
                  <p className="mt-1 text-xs text-muted">{filter ? 'Try another search.' : 'Upload a file or create a folder.'}</p>
                  {path && !filter && <button className="mt-4 rounded-xl border border-line bg-white px-4 py-3 text-xs text-muted hover:text-ink"
                    onClick={removeEmptyFolder} disabled={!!busy}>Remove empty folder</button>}
                </div>
              ) : (
                <div className="divide-y divide-line">
                  {shown.map((item) => (
                    <button key={item.path} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper sm:px-5"
                      onClick={() => open(item)} disabled={!!busy}>
                      <ItemIcon item={item} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.name}</span>
                        <span className="mt-1 block text-xs text-muted">{item.type === 'dir' ? 'Folder' : readableSize(item.size)}</span>
                      </span>
                      <ChevronRight size={17} className="shrink-0 text-muted" />
                    </button>
                  ))}
                </div>
              )}
              {items.length >= 1000 && <p className="border-t border-line p-3 text-xs text-muted">GitHub lists at most 1,000 items per folder.</p>}
            </div>

            {path && (
              <button className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted hover:text-ink"
                onClick={() => { setPath(segments.slice(0, -1).join('/')); setFilter(''); }}>
                <ArrowLeft size={16} /> Back to parent folder
              </button>
            )}
            <p className="mt-5 text-xs leading-5 text-muted">
              10 MiB upload limit. Files stored in Git history still count toward repository size, even after deletion.
            </p>
          </section>
        )}
        {error && (
          <div role="alert" className="mt-5 flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <p className="break-words">{error}</p>
            <button className="shrink-0" aria-label="Dismiss error" onClick={() => setError('')}><X size={18} /></button>
          </div>
        )}
      </main>

      {selected && connection && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-5" role="presentation"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <section className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:rounded-2xl"
            role="dialog" aria-modal="true" aria-label={'Preview ' + selected.name}>
            <div className="flex items-center gap-3 border-b border-line p-4 sm:px-5">
              <ItemIcon item={selected} />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold">{selected.name}</h3>
                <p className="text-xs text-muted">{readableSize(selected.size)}</p>
                <a className="mt-1 inline-block text-xs text-accent underline underline-offset-2" target="_blank" rel="noopener noreferrer"
                  href={'https://github.com/' + connection.repo.full_name + '/commits/' + encodeURIComponent(connection.repo.default_branch) + '/' + encodePath(selected.path)}>
                  View file history
                </a>
              </div>
              <button className="flex size-11 items-center justify-center rounded-xl hover:bg-paper"
                aria-label="Close preview" onClick={() => setSelected(null)}><X size={19} /></button>
            </div>
            <div className="min-h-28 flex-1 overflow-auto bg-paper p-4">
              {preview.kind === 'loading' && <p className="py-10 text-center text-sm text-muted">Loading preview…</p>}
              {preview.kind === 'image' && <img className="mx-auto max-h-[52dvh] max-w-full rounded-lg object-contain"
                src={preview.value} alt={selected.name} />}
              {preview.kind === 'text' && <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-white p-4 font-mono text-xs leading-5">{preview.value}</pre>}
              {preview.kind === 'other' && <p className="py-10 text-center text-sm text-muted">No inline preview for this file. Download to open it.</p>}
              {preview.kind === 'error' && <p className="py-10 text-center text-sm text-red-700">Preview unavailable: {preview.value}</p>}
            </div>
            {error && <p role="alert" className="border-t border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">{error}</p>}
            <div className="grid grid-cols-3 gap-2 border-t border-line p-3 sm:p-4">
              <button className={secondary} disabled={!!busy} onClick={() => rename(selected)}><Pencil size={16} /> Rename</button>
              <button className={secondary} disabled={!!busy} onClick={() => remove(selected)}><Trash2 size={16} /> Delete</button>
              <button className={primary} disabled={!!busy} onClick={() => download(selected)}>
                <ArrowDownToLine size={16} /> Save
              </button>
            </div>
          </section>
        </div>
      )}

      <footer className="mx-auto flex max-w-5xl items-center justify-center gap-2 px-4 pb-6 text-xs text-muted">
        <GitBranch size={15} /> Powered by GitHub's Contents API. No server of its own.
      </footer>
    </div>
  );
}
