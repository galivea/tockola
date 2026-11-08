/**
 * One-line "command" text <-> the task XML <Command> + <Arguments>.
 *
 * The UI asks for a single command line (exactly what you would type in
 * cmd) and splits it on save into the two pieces Task Scheduler requires:
 * Command (program path) and Arguments.
 *
 * The hard part is spaces inside the path, e.g.
 *   C:\Program Files\App\app.exe -a -b   -> program contains spaces
 *   powershell -File D:\x\run.ps1 -x     -> first token is the program,
 *                                           the extension sits in the args
 * So the split is decided by an "extension breakpoint", not the first space.
 */

// Common executable extensions; they decide where the program part ends.
const EXTS = [
  ".exe", ".bat", ".cmd", ".com", ".ps1", ".vbs", ".vbe", ".js", ".jse",
  ".wsf", ".wsh", ".msc", ".msi", ".jar", ".py", ".pyw", ".scr", ".lnk",
];

function endsWithExt(text) {
  const lower = text.toLowerCase();
  return EXTS.some((e) => lower.endsWith(e));
}

/** Split a full command line into { command, arguments }. */
export function splitCommand(line) {
  const text = String(line || "").trim();
  if (!text) return { command: "", arguments: "" };

  // Leading quote: everything inside counts as the program, spaces or not.
  if (text[0] === '"') {
    const close = text.indexOf('"', 1);
    if (close > 0) {
      return {
        command: text.slice(1, close),
        arguments: text.slice(close + 1).trim(),
      };
    }
  }

  const firstSpace = text.indexOf(" ");
  if (firstSpace < 0) return { command: text, arguments: "" };

  const head = text.slice(0, firstSpace);

  // The first token is already an executable: cut right here.
  if (endsWithExt(head)) {
    return { command: head, arguments: text.slice(firstSpace + 1).trim() };
  }

  // The first token contains a backslash or slash, so it is a path that a
  // space cut short; scan forward for the first "extension end + space".
  if (head.includes("\\") || head.includes("/")) {
    let i = 0;
    while (i < text.length) {
      const sp = text.indexOf(" ", i);
      if (sp < 0) break;
      if (endsWithExt(text.slice(0, sp))) {
        return {
          command: text.slice(0, sp),
          arguments: text.slice(sp + 1).trim(),
        };
      }
      i = sp + 1;
    }
  }

  // Fallback: cut at the first space (e.g. powershell -File x.ps1).
  return { command: head, arguments: text.slice(firstSpace + 1).trim() };
}

/** Join { command, arguments } back into one command line. */
export function mergeCommand(command, args) {
  const c = String(command || "").trim();
  const a = String(args || "").trim();
  if (!c) return a;
  // The path has spaces and is not quoted yet: add quotes, or it will not
  // split back correctly.
  const quoted = c.includes(" ") && !c.startsWith('"') ? `"${c}"` : c;
  return a ? `${quoted} ${a}` : quoted;
}
