import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icons } from '../components/Icons';
import { api } from '../lib/api';

export function Admin({ me }) {
  const [users, setUsers] = useState([]);
  const [accessMode, setAccessMode] = useState('everyone');
  const [allowedUserIds, setAllowedUserIds] = useState([]);
  const [accessError, setAccessError] = useState('');
  const [accessLoading, setAccessLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [archived, setArchived] = useState([]);
  const [archivedError, setArchivedError] = useState('');
  const [archivedLoading, setArchivedLoading] = useState(true);
  const [busyRecipeId, setBusyRecipeId] = useState('');

  useEffect(() => {
    if (!me.isAdmin) return;

    api.get('/cookbook/admin/users')
      .then((res) => {
        setUsers(res.users || []);
        setAccessMode(res.access?.mode === 'selected' ? 'selected' : 'everyone');
        setAllowedUserIds(res.access?.allowedUserIds || []);
      })
      .catch((err) => setAccessError(err.message))
      .finally(() => setAccessLoading(false));

    api.get('/cookbook/admin/archived')
      .then((res) => setArchived(res.recipes || []))
      .catch((err) => setArchivedError(err.message))
      .finally(() => setArchivedLoading(false));
  }, [me.isAdmin]);

  if (!me.isAdmin) {
    return (
      <div className="panel">
        <div className="panel__body">
          <div className="empty-inline">This page is only available to cookbook admins.</div>
        </div>
      </div>
    );
  }

  const toggleUser = (userId) => {
    setAllowedUserIds((prev) => prev.includes(userId)
      ? prev.filter((id) => id !== userId)
      : [...prev, userId]);
  };

  const saveAccess = async () => {
    setSaving(true);
    setAccessError('');
    try {
      const res = await api.put('/cookbook/admin/access', { mode: accessMode, allowedUserIds });
      setAccessMode(res.access?.mode === 'selected' ? 'selected' : 'everyone');
      setAllowedUserIds(res.access?.allowedUserIds || []);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setAccessError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const restoreRecipe = async (recipeId) => {
    setBusyRecipeId(recipeId);
    setArchivedError('');
    try {
      await api.post(`/cookbook/admin/recipes/${recipeId}/restore`, {});
      setArchived((prev) => prev.filter((recipe) => recipe.id !== recipeId));
    } catch (err) {
      setArchivedError(err.message);
    } finally {
      setBusyRecipeId('');
    }
  };

  const destroyRecipe = async (recipe) => {
    if (!window.confirm(`Permanently delete "${recipe.title}"? This cannot be undone.`)) return;
    setBusyRecipeId(recipe.id);
    setArchivedError('');
    try {
      await api.delete(`/cookbook/admin/recipes/${recipe.id}`);
      setArchived((prev) => prev.filter((item) => item.id !== recipe.id));
    } catch (err) {
      setArchivedError(err.message);
    } finally {
      setBusyRecipeId('');
    }
  };

  return (
    <>
      <div className="page__header">
        <div>
          <Link className="btn cookbook-back" to="/cookbook">
            <Icons.ChevronLeft size={14} /> Back to recipes
          </Link>
          <h1 className="page__title">Admin</h1>
        </div>
      </div>

      <div className="admin-panels">
        <div className="panel">
          <div className="panel__header">
            <div className="panel__title">Cookbook access</div>
            <div className="panel__meta">who can view and add recipes</div>
          </div>
          <div className="panel__body admin-access">
            {accessError && <div className="inline-alert inline-alert--error">{accessError}</div>}
            {accessLoading ? (
              <div className="empty-inline">Loading users…</div>
            ) : (
              <>
                <div className="seg">
                  <button
                    className={`seg__btn ${accessMode === 'everyone' ? 'is-active' : ''}`}
                    onClick={() => setAccessMode('everyone')}
                  >
                    All users
                  </button>
                  <button
                    className={`seg__btn ${accessMode === 'selected' ? 'is-active' : ''}`}
                    onClick={() => setAccessMode('selected')}
                  >
                    Selected users
                  </button>
                </div>

                {accessMode === 'selected' && (
                  <div className="admin-access__users">
                    <div className="field__label">Users with access (admins always have access)</div>
                    <div className="cookbook-category-picker">
                      {users.map((user) => {
                        const active = allowedUserIds.includes(user.id);
                        return (
                          <button
                            key={user.id}
                            type="button"
                            className={`access-chip ${active ? 'is-active' : ''}`}
                            onClick={() => toggleUser(user.id)}
                          >
                            <span>{user.name}</span>
                          </button>
                        );
                      })}
                    </div>
                    {users.length === 0 && (
                      <div className="empty-inline">
                        No users yet. Users appear here after they open the cookbook once.
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <button className="btn btn--primary" onClick={saveAccess} disabled={saving}>
                    <Icons.Check size={13} /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save access settings'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel__header">
            <div className="panel__title">Archived recipes</div>
            <div className="panel__meta">{archivedLoading ? 'loading' : `${archived.length} archived`}</div>
          </div>
          <div className="panel__body admin-archived">
            {archivedError && <div className="inline-alert inline-alert--error">{archivedError}</div>}
            {archivedLoading && <div className="empty-inline">Loading archived recipes…</div>}
            {!archivedLoading && archived.length === 0 && (
              <div className="empty-inline">No archived recipes. Deleted recipes land here.</div>
            )}
            {archived.map((recipe) => (
              <div className="admin-archived__row" key={recipe.id}>
                {recipe.imageUrl ? (
                  <img src={recipe.imageUrl} alt={recipe.title} className="admin-archived__image" />
                ) : (
                  <div className="admin-archived__image admin-archived__image--empty">No image</div>
                )}
                <div className="admin-archived__body">
                  <Link className="admin-archived__title" to={`/cookbook/${recipe.id}`}>{recipe.title}</Link>
                  <div className="cookbook-list__meta">
                    by {recipe.ownerName}
                    {recipe.archivedAt ? ` · archived ${formatDate(recipe.archivedAt)}` : ''}
                    {recipe.archivedByName ? ` by ${recipe.archivedByName}` : ''}
                  </div>
                </div>
                <div className="admin-archived__actions">
                  <button
                    className="btn"
                    onClick={() => restoreRecipe(recipe.id)}
                    disabled={busyRecipeId === recipe.id}
                  >
                    Restore
                  </button>
                  <button
                    className="btn btn--danger"
                    onClick={() => destroyRecipe(recipe)}
                    disabled={busyRecipeId === recipe.id}
                  >
                    Delete forever
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}
