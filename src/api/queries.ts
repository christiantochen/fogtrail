import {
  keepPreviousData,
  useInfiniteQuery,
  useQueries,
  useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type { Known, TableRef } from "../lib/sqlComplete";
import { globFor } from "../lib/tree";
import {
  getKey,
  listProfiles,
  listSchemas,
  listTables,
  scanKeys,
  serverInfo,
  tableRows,
  tableStructure,
} from "./browse";
import type { AppError } from "./types";

const PAGE = 500;

export const useProfiles = () =>
  useQuery({ queryKey: ["profiles"], queryFn: listProfiles });

/** Keys, one SCAN page at a time. `fetchNextPage` follows the server cursor. */
export function useKeys(pattern?: string, kind?: string | null) {
  return useInfiniteQuery<
    Awaited<ReturnType<typeof scanKeys>>,
    AppError,
    { items: Awaited<ReturnType<typeof scanKeys>>["items"]; hasMore: boolean },
    (string | null | undefined)[],
    string | null
  >({
    queryKey: ["keys", pattern, kind ?? null],
    initialPageParam: null,
    queryFn: async ({ pageParam }) => {
      const page = await scanKeys({
        pattern,
        cursor: pageParam,
        count: PAGE,
        kind,
      });
      // Stamp each key with its scan time, so a TTL counts down from when it was read.
      const scannedAt = Date.now();
      return {
        ...page,
        items: page.items.map((k) => ({ ...k, scannedAt })),
      };
    },
    getNextPageParam: (last) => last.nextCursor,
    select: (data) => ({
      items: data.pages.flatMap((p) => p.items),
      hasMore: data.pages[data.pages.length - 1]?.nextCursor != null,
    }),
    retry: false,
  });
}

/** `refreshSeconds` re-reads the key on a timer; it stops on an error and while the window is hidden. */
export const useKeyDetail = (name: string | null, refreshSeconds = 0) =>
  useQuery({
    queryKey: ["key", name],
    queryFn: () => getKey(name as string),
    enabled: name !== null,
    retry: false,
    // Reopening a key always reads it again, so an old value is never shown as current.
    staleTime: 0,
    refetchInterval: (query) =>
      refreshSeconds > 0 && query.state.status !== "error"
        ? refreshSeconds * 1000
        : false,
  });

/** Server health. Polls while `live`, so the panel stays current without a refresh button. */
export const useServerInfo = (live = false) =>
  useQuery({
    queryKey: ["serverInfo"],
    queryFn: serverInfo,
    refetchInterval: live ? 5000 : false,
    retry: false,
  });

/**
 * Keys matching `term`, for quick open. SCAN can return empty pages while a match
 * is still ahead, so this keeps going until it has `want` keys or the keyspace ends.
 */
export function useQuickKeys(term: string, want = 20) {
  return useQuery({
    queryKey: ["quick", term],
    enabled: term !== "",
    retry: false,
    gcTime: 0,
    queryFn: async () => {
      const found: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 200 && found.length < want; page++) {
        const res: Awaited<ReturnType<typeof scanKeys>> = await scanKeys({
          pattern: globFor(term),
          cursor,
          count: 1000,
        });
        for (const k of res.items) found.push(k.name);
        cursor = res.nextCursor;
        if (cursor === null) break;
      }
      return { keys: found.slice(0, want), more: cursor !== null };
    },
  });
}

/** Query keys that belong to a SQL connection. Dropped together when the connection changes. */
export const SQL_KEYS = ["schemas", "tables", "structure", "rows"] as const;

export const useSchemas = () =>
  useQuery({ queryKey: ["schemas"], queryFn: listSchemas, retry: false });

export const useTables = (schema: string | null) =>
  useQuery({
    queryKey: ["tables", schema],
    queryFn: () => listTables(schema as string),
    enabled: schema !== null,
    retry: false,
  });

export const useStructure = (schema: string, table: string) =>
  useQuery({
    queryKey: ["structure", schema, table],
    queryFn: () => tableStructure(schema, table),
    retry: false,
    staleTime: 0,
  });

/** One page of rows. The previous page stays on screen while the next one loads. */
export const useRows = (schema: string, table: string, offset: number) =>
  useQuery({
    queryKey: ["rows", schema, table, offset],
    queryFn: () => tableRows(schema, table, offset),
    retry: false,
    staleTime: 0,
    placeholderData: keepPreviousData,
  });

/**
 * What the query editor knows about the open connection, for suggestions: the
 * tables of the open database, other database names, and the columns of the
 * tables the statement mentions. Columns are fetched only for those tables, and
 * only once their name matches a real table, so typing half a name asks for nothing.
 */
const sameName = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

export function useCompletionKnown(
  schema: string | null,
  refs: TableRef[],
  qualifier: string | null,
): Known {
  const tables = useTables(schema);
  const schemas = useSchemas();
  const names = useMemo(
    () => schemas.data?.map((s) => s.name) ?? [],
    [schemas.data],
  );
  // `analytics.` asks for the tables of the database of that name.
  const other =
    qualifier !== null
      ? (names.find((n) => n.toLowerCase() === qualifier.toLowerCase()) ?? null)
      : null;
  const otherTables = useTables(other);

  const wanted = useMemo(() => {
    const out: { schema: string; table: string }[] = [];
    for (const r of refs) {
      const inSchema = r.schema ?? schema;
      if (inSchema === null) continue;
      const mine = sameName(inSchema, schema);
      const list = mine
        ? tables.data
        : sameName(inSchema, other)
          ? otherTables.data
          : undefined;
      const real = list?.find((t) => sameName(t.name, r.table));
      const dbName = mine ? schema : other;
      if (
        real &&
        dbName &&
        !out.some(
          (w) => sameName(w.table, real.name) && sameName(w.schema, dbName),
        )
      ) {
        out.push({ schema: dbName, table: real.name });
      }
    }
    return out;
  }, [refs, schema, other, tables.data, otherTables.data]);
  const structures = useQueries({
    queries: wanted.map((w) => ({
      queryKey: ["structure", w.schema, w.table],
      queryFn: () => tableStructure(w.schema, w.table),
      retry: false,
      staleTime: 30_000,
    })),
    combine: (results) => results.map((r) => r.data),
  });

  return useMemo<Known>(() => {
    const byName = new Map<string, { name: string; dataType: string }[]>();
    wanted.forEach((w, i) => {
      const data = structures[i];
      if (data)
        byName.set(`${w.schema}.${w.table}`.toLowerCase(), data.columns);
    });
    const view = (t: { name: string; kind: string }) => ({
      name: t.name,
      view: t.kind === "view",
    });
    return {
      tables: (tables.data ?? []).map(view),
      schemas: names,
      columns: (table, inSchema) =>
        byName.get(`${inSchema ?? schema ?? ""}.${table}`.toLowerCase()),
      tablesOf: (s) =>
        sameName(s, schema)
          ? tables.data?.map(view)
          : sameName(s, other)
            ? otherTables.data?.map(view)
            : undefined,
    };
  }, [tables.data, otherTables.data, names, schema, other, structures, wanted]);
}
