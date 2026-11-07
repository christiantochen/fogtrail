import { useToast } from "../state/toast";

/** Copies `text` and says so. `what` names it in the message, such as "key name". */
export async function copyText(text: string, what: string): Promise<void> {
  const { show } = useToast.getState();
  try {
    await navigator.clipboard.writeText(text);
    show(`Copied ${what}`);
  } catch {
    show(`Couldn’t copy ${what}`);
  }
}

/** The redis-cli command that reads a key of this type. */
export function readCommand(kind: string, name: string): string {
  const key = `"${name.replace(/[\\"$`]/g, "\\$&")}"`;
  switch (kind) {
    case "string":
      return `GET ${key}`;
    case "hash":
      return `HGETALL ${key}`;
    case "list":
      return `LRANGE ${key} 0 -1`;
    case "set":
      return `SMEMBERS ${key}`;
    case "zset":
      return `ZRANGE ${key} 0 -1 WITHSCORES`;
    case "stream":
      return `XREVRANGE ${key} + - COUNT 100`;
    default:
      return `TYPE ${key}`;
  }
}
