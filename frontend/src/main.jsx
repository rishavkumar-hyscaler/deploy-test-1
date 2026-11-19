import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

async function api(path = '', options = {}) {
  const response = await fetch(`/api/tasks${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.status === 204 ? null : response.json();
}
function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api().then(setTasks).catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  async function mutate(work) {
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function save(event) {
    event.preventDefault();
    mutate(async () => {
      if (editing !== null) {
        const task = tasks.find(t => t.id === editing);
        const updated = await api(`/${editing}`, { method: 'PUT', body: JSON.stringify({ title, completed: task.completed }) });
        setTasks(items => items.map(t => t.id === editing ? updated : t));
      } else {
        const created = await api('', { method: 'POST', body: JSON.stringify({ title }) });
        setTasks(items => [created, ...items]);
      }
      setTitle(''); setEditing(null);
    });
  }
  return <main>
    <header><span className="eyebrow">REACT · RUST · POSTGRESQL</span><h1>Task Board<span>.</span></h1><p>A small app. A full stack. Your DevOps playground.</p></header>
    <form onSubmit={save}>
      <label htmlFor="title">{editing !== null ? 'Edit task' : 'New task'}</label>
      <div className="input-row"><input id="title" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder="What needs to get done?" required disabled={busy || loading}/><button disabled={busy || loading || !title.trim()}>{editing !== null ? 'Save' : 'Add task'}</button></div>
      {editing !== null && <button className="text-button" type="button" disabled={busy} onClick={() => { setEditing(null); setTitle(''); }}>Cancel editing</button>}
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    <section aria-label="Tasks" aria-busy={loading || busy}>
      <div className="list-heading"><h2>Your tasks</h2><span>{tasks.filter(t => t.completed).length} / {tasks.length} done</span></div>
      {loading ? <p className="empty">Loading tasks…</p> : tasks.length === 0 ? <p className="empty">Nothing here yet. Add your first task above.</p> : <ul>{tasks.map(task => <li key={task.id}>
        <input type="checkbox" aria-label={`Mark ${task.title} ${task.completed ? 'incomplete' : 'complete'}`} checked={task.completed} disabled={busy} onChange={() => mutate(async () => {
          const updated = await api(`/${task.id}`, { method: 'PUT', body: JSON.stringify({ title: task.title, completed: !task.completed }) });
          setTasks(items => items.map(t => t.id === task.id ? updated : t));
        })}/>
        <span className={`task-title ${task.completed ? 'done' : ''}`}>{task.title}</span>
        <button className="text-button" disabled={busy} onClick={() => { setEditing(task.id); setTitle(task.title); document.getElementById('title').focus(); }}>Edit</button>
        <button className="text-button danger" disabled={busy} onClick={() => mutate(async () => {
          await api(`/${task.id}`, { method: 'DELETE' });
          setTasks(items => items.filter(t => t.id !== task.id));
          if (editing === task.id) { setEditing(null); setTitle(''); }
        })}>Delete</button>
      </li>)}</ul>}
    </section><footer>Changes are saved in PostgreSQL.</footer>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
