export type CsvProfile = { name: string | null; linkedinUrl: string };
export type CsvError = { row: number; message: string };

function parseRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (character === '"') {
      if (quoted && next === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += character;
  }

  if (quoted) throw new Error("A quoted cell is not closed.");
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function headerKey(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

export function canonicalLinkedInProfileUrl(value: string): string | null {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    if (hostname !== "linkedin.com" || segments[0]?.toLowerCase() !== "in" || !segments[1]) return null;
    const slug = segments[1].trim();
    if (!/^[a-zA-Z0-9%_-]+$/.test(slug)) return null;
    return `https://www.linkedin.com/in/${slug}`;
  } catch {
    return null;
  }
}

export function parseProfileCsv(input: string): { profiles: CsvProfile[]; errors: CsvError[] } {
  const rows = parseRows(input);
  if (rows.length === 0) return { profiles: [], errors: [{ row: 1, message: "The CSV is empty." }] };

  const headers = rows[0].map(headerKey);
  const urlIndex = headers.findIndex((header) =>
    ["linkedin url", "linkedin", "profile url", "url"].includes(header),
  );
  const nameIndex = headers.findIndex((header) => ["name", "person", "full name"].includes(header));

  if (urlIndex === -1) {
    return { profiles: [], errors: [{ row: 1, message: "Add a linkedin_url column." }] };
  }

  const profiles: CsvProfile[] = [];
  const errors: CsvError[] = [];
  const seen = new Set<string>();

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const rawUrl = row[urlIndex]?.trim() ?? "";
    if (!rawUrl) {
      errors.push({ row: rowNumber, message: "LinkedIn URL is missing." });
      return;
    }
    const linkedinUrl = canonicalLinkedInProfileUrl(rawUrl);
    if (!linkedinUrl) {
      errors.push({ row: rowNumber, message: "Use a public linkedin.com/in/... profile URL." });
      return;
    }
    if (seen.has(linkedinUrl)) return;
    seen.add(linkedinUrl);
    const rawName = nameIndex >= 0 ? row[nameIndex]?.trim() : "";
    profiles.push({ name: rawName || null, linkedinUrl });
  });

  return { profiles, errors };
}
