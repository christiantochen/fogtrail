import { useCallback } from "react";
import type { ForeignKeyInfo, ResultColumn } from "../api/types";
import { fkFilter, fkFor, fkLabel } from "../lib/fk";
import { sqlDialectOf } from "../lib/sql";
import { useUi } from "../state/ui";

/** Where a foreign-key value leads, and the way to go there. */
export interface FkLink {
  /** "customers.id", for the tooltip and the chip. */
  label: string;
  follow: () => void;
}

/**
 * Finds the link for one value of a row, or null when its column is no foreign key, the key
 * has a null part, or the structure has not loaded yet.
 */
export function useForeignKeys(
  schema: string,
  foreignKeys: readonly ForeignKeyInfo[] | undefined,
): (
  columns: readonly ResultColumn[],
  row: readonly (string | null)[],
  column: string,
) => FkLink | null {
  const dialect = sqlDialectOf(useUi((s) => s.connected?.driver));
  const follow = useUi((s) => s.followForeignKey);
  return useCallback(
    (columns, row, column) => {
      if (!foreignKeys || foreignKeys.length === 0) return null;
      const fk = fkFor(foreignKeys, column);
      if (!fk) return null;
      const filter = fkFilter(dialect, fk, columns, row);
      if (filter === null) return null;
      return {
        label: fkLabel(fk, schema),
        follow: () => follow(fk.refSchema, fk.refTable, filter),
      };
    },
    [dialect, follow, foreignKeys, schema],
  );
}
