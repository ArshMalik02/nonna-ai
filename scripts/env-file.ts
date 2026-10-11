import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Sets KEY=value in a dotenv file, replacing an existing line or appending. Keeps mode 0600. */
export function setEnvVar(path: string, key: string, value: string) {
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const i = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.splice(lines.at(-1) === "" ? -1 : lines.length, 0, `${key}=${value}`);
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
}
