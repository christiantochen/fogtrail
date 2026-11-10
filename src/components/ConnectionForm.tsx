import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  connect,
  deleteProfile,
  saveProfile,
  testConnection,
} from "../api/browse";
import type { AppError, Profile } from "../api/types";
import {
  DRIVERS,
  defaultPort,
  draftOf,
  emptyDraft,
  toProfile,
  validate,
  type Draft,
  type DriverId,
} from "../lib/profile";
import {
  applyUrl,
  buildConnectionUrl,
  looksLikeUrl,
  parseConnectionUrl,
  type Filled,
} from "../lib/redisUrl";
import { copyText } from "../lib/clipboard";
import { useUi } from "../state/ui";
import { Check, Lock } from "./Icons";
import { Switch } from "./Switch";
import { dropBrowsingCaches } from "../lib/refreshAll";

export function ConnectionForm({
  profile,
  first,
}: {
  profile: Profile | null;
  first: boolean;
}) {
  const qc = useQueryClient();
  const setConnected = useUi((s) => s.setConnected);
  const edit = useUi((s) => s.edit);
  const liveId = useUi((s) => (s.connected ? s.connectedId : null));

  const [draft, setDraft] = useState<Draft>(() =>
    profile ? draftOf(profile) : emptyDraft(),
  );
  const [password, setPassword] = useState("");
  // What the last pasted URL did: a hint when it filled fields, a message when it was refused.
  const [urlNote, setUrlNote] = useState<
    | { kind: "ok"; filled: Filled; tls: boolean }
    | { kind: "error"; message: string }
    | null
  >(null);
  const [shown, setShown] = useState(false); // show errors only after a first attempt
  const errors = validate(draft);
  const invalid = Object.keys(errors).length > 0;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  // Another data store resets what only makes sense for the first: the port, if it was untouched.
  const setDriver = (driver: DriverId) => {
    setUrlNote(null);
    setDraft((d) => ({
      ...d,
      driver,
      port:
        d.port === String(defaultPort(d.driver))
          ? String(defaultPort(driver))
          : d.port,
    }));
  };
  const mysql = draft.driver === "mysql";

  // Pasting a redis:// or mysql:// URL into Host fills the form. Anything that fails to
  // parse is refused as a whole, so nothing the user typed is lost.
  const onPasteHost = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").trim();
    if (!looksLikeUrl(text)) return; // an ordinary hostname pastes as usual
    e.preventDefault();
    const parsed = parseConnectionUrl(text, draft.driver);
    if (!parsed.ok) {
      setUrlNote({ kind: "error", message: parsed.error });
      return;
    }
    const next = applyUrl(draft, password, parsed.value, !profile);
    setDraft(next.draft);
    setPassword(next.password);
    setUrlNote({ kind: "ok", filled: next.filled, tls: next.draft.tls });
  };

  const id = profile?.id ?? "";
  // Blank means "keep the saved one" for existing profiles.
  const pw = password === "" ? null : password;

  const test = useMutation({
    mutationFn: () => testConnection(toProfile(draft, id), pw),
  });
  const save = useMutation({
    mutationFn: async (andConnect: boolean) => {
      const saved = await saveProfile(toProfile(draft, id), pw);
      await qc.invalidateQueries({ queryKey: ["profiles"] });
      if (andConnect) {
        dropBrowsingCaches(qc);
        setConnected(await connect(saved.id), saved.id);
      } else {
        // The backend drops the live connection when its profile is saved.
        if (saved.id === liveId) setConnected(null);
        edit(null);
      }
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      await deleteProfile(id);
      await qc.invalidateQueries({ queryKey: ["profiles"] });
      if (id === liveId) setConnected(null);
      edit(null);
    },
  });

  const run = (fn: () => void) => {
    setShown(true);
    if (!invalid) fn();
  };
  const err = (k: keyof Draft) => (shown ? errors[k] : undefined);
  const failure: AppError | null = save.error ?? test.error ?? remove.error;
  const busy = test.isPending || save.isPending || remove.isPending;

  return (
    <section className="form" aria-labelledby="form-title">
      <div>
        <h1 id="form-title">
          {first
            ? "Add your first connection"
            : profile
              ? "Edit connection"
              : "New connection"}
        </h1>
        <p className="muted">
          {profile
            ? "Fogtrail reads from this server. It never writes to it."
            : "Choose what to connect to. Fogtrail only reads."}
        </p>
      </div>

      {!profile && (
        <div role="radiogroup" aria-label="Data store" className="drivers">
          {DRIVERS.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              className="driver"
              aria-checked={draft.driver === d.id}
              onClick={() => setDriver(d.id)}
            >
              <span className="driver__name">{d.label}</span>
              <span className="muted">{d.blurb}</span>
            </button>
          ))}
        </div>
      )}

      <Field label="Name" error={err("name")}>
        <input
          autoFocus
          value={draft.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder={mysql ? "shop-prod" : "local-redis"}
        />
      </Field>

      <div className="form__row">
        <Field
          label="Host"
          error={urlNote?.kind === "error" ? urlNote.message : err("host")}
          grow
        >
          <input
            className="mono"
            value={draft.host}
            placeholder={`Host, or paste a ${mysql ? "mysql" : "redis"}:// URL`}
            onPaste={onPasteHost}
            onChange={(e) => {
              setUrlNote(null);
              set("host", e.target.value);
            }}
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Port" error={err("port")} width={120}>
          <input
            className="mono"
            inputMode="numeric"
            value={draft.port}
            onChange={(e) => set("port", e.target.value)}
          />
        </Field>
      </div>

      {urlNote?.kind === "ok" && (
        <span role="status" className="hint hint--ok">
          <Check width={13} height={13} /> Filled from URL:{" "}
          {urlNote.filled
            .map((f) =>
              f === "tls" ? (urlNote.tls ? "TLS on" : "TLS off") : f,
            )
            .join(", ")}
        </span>
      )}

      <div className="form__row">
        <Field
          label={mysql ? "User" : "Username (ACL, optional)"}
          error={err("username")}
          grow
        >
          <input
            className="mono"
            placeholder={mysql ? "fogtrail" : "default"}
            value={draft.username}
            onChange={(e) => set("username", e.target.value)}
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        {mysql ? (
          <Field label="Database (optional)" error={err("schema")} width={200}>
            <input
              className="mono"
              placeholder="shop"
              value={draft.schema}
              onChange={(e) => set("schema", e.target.value)}
              autoCapitalize="off"
              spellCheck={false}
            />
          </Field>
        ) : (
          <Field label="Database" error={err("database")} width={120}>
            <input
              className="mono"
              inputMode="numeric"
              value={draft.database}
              onChange={(e) => set("database", e.target.value)}
            />
          </Field>
        )}
      </div>

      <div className="field">
        <label className="field__label" htmlFor="pw">
          Password
        </label>
        <input
          id="pw"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={
            profile
              ? "Leave blank to keep the saved password"
              : "No password (local server)"
          }
        />
        <span className="hint">
          <Lock width={13} height={13} /> Saved in your system keychain, never
          in a file.
        </span>
      </div>

      <UrlCopy draft={draft} password={password} saved={!!profile} />

      {mysql && <ReadOnlyUserTip draft={draft} />}

      <div className="panel">
        <div className="toggle">
          <div>
            <div className="toggle__title">Use TLS</div>
            <div className="muted">
              Encrypt the connection. Most managed servers require it.
            </div>
          </div>
          <Switch
            label="Use TLS"
            checked={draft.tls}
            onChange={(v) => set("tls", v)}
          />
        </div>
        <div className="toggle toggle--last">
          <div>
            <div className="toggle__title">Read-only</div>
            <div className="muted">
              Fogtrail only reads in this version, so this stays on.
            </div>
          </div>
          <Switch label="Read-only" checked disabled />
        </div>
      </div>

      {profile && profile.id === liveId && (
        <div role="status" className="alert">
          This connection is open. Saving changes disconnects it; use Save and
          connect to reconnect straight away.
        </div>
      )}
      {test.data && (
        <div role="status" className="alert alert--ok">
          Connected. Detected {test.data.product} {test.data.version}
          {test.data.keyCount === null
            ? "."
            : `, with ${test.data.keyCount} keys in db${draft.database}.`}
        </div>
      )}
      {failure && (
        <div role="alert" className="alert alert--block">
          {failure.message}
        </div>
      )}

      <div className="form__foot">
        {profile ? (
          <button
            type="button"
            className="btn btn--danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Delete “${profile.name}”? Its saved password is removed too.`,
                )
              ) {
                remove.mutate();
              }
            }}
          >
            Delete connection
          </button>
        ) : (
          <span />
        )}
        <div className="actions">
          {!first && (
            <button
              type="button"
              className="btn"
              disabled={save.isPending}
              onClick={() => edit(null)}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => test.mutate())}
          >
            {test.isPending ? "Testing…" : "Test connection"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => run(() => save.mutate(false))}
          >
            Save
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => run(() => save.mutate(true))}
          >
            {save.isPending ? "Connecting…" : "Save and connect"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field(props: {
  label: string;
  error?: string;
  grow?: boolean;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <label
      className="field"
      style={
        props.grow
          ? { flex: 1 }
          : props.width
            ? { width: props.width }
            : undefined
      }
    >
      <span className="field__label">{props.label}</span>
      {props.children}
      {props.error && (
        <span role="alert" className="field__error">
          {props.error}
        </span>
      )}
    </label>
  );
}

/** Shows the connection as a redis:// URL to copy. The password is only in it when asked for. */
function UrlCopy({
  draft,
  password,
  saved,
}: {
  draft: Draft;
  password: string;
  saved: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [include, setInclude] = useState(false);
  const url = buildConnectionUrl(draft, password, include);
  return (
    <div className="urlcopy">
      <button
        type="button"
        className="btn btn--small"
        aria-expanded={open}
        disabled={draft.host.trim() === ""}
        onClick={() => setOpen(!open)}
      >
        Copy as URL
      </button>
      {open && (
        <div className="urlcopy__box">
          <code className="mono urlcopy__url" aria-label="Connection URL">
            {url}
          </code>
          {password !== "" ? (
            <label className="urlcopy__reveal">
              <input
                type="checkbox"
                checked={include}
                onChange={(e) => setInclude(e.target.checked)}
              />
              Include the password in the URL
            </label>
          ) : (
            <span className="hint">
              {saved
                ? "No password in this URL. The saved one stays in your keychain and can’t be read back here. Type it above to include it."
                : "No password in this URL because none is typed above."}
            </span>
          )}
          {password !== "" && !include && (
            <span className="hint">
              The password is left out. Tick the box to add it.
            </span>
          )}
          <div className="urlcopy__row">
            <span />
            <button
              type="button"
              className="btn btn--small"
              onClick={() => void copyText(url, "connection URL")}
            >
              Copy URL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The server is the strongest read-only guard, so the form says how to set one up. */
function ReadOnlyUserTip({ draft }: { draft: Draft }) {
  const user = draft.username.trim() || "fogtrail";
  const db = draft.schema.trim() || "your_database";
  const quote = (s: string) => s.replace(/'/g, "''");
  return (
    <div className="panel dbtip">
      <div className="toggle__title">Safer with a read-only MySQL user</div>
      <p className="muted">
        Fogtrail only sends read statements, and the server enforces it too.
        Create a user that can only read:
      </p>
      <pre className="code code--tip">
        {`CREATE USER '${quote(user)}'@'%' IDENTIFIED BY '<password>';\nGRANT SELECT, SHOW VIEW ON \`${db}\`.* TO '${quote(user)}'@'%';`}
      </pre>
    </div>
  );
}
