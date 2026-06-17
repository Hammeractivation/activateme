interface GitHubContentFile {
  name: string;
  sha: string;
  content?: string;
  encoding?: string;
}

interface GitHubCommit {
  commit: {
    committer: { date: string };
  };
}

function githubHeaders(pat: string): HeadersInit {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "ActivateMe-Worker/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentsUrl(owner: string, repo: string, path: string): string {
  return `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
}

export async function keyFileExists(
  owner: string,
  repo: string,
  pat: string,
  key: string
): Promise<boolean> {
  const res = await fetch(contentsUrl(owner, repo, `${key}.txt`), {
    headers: githubHeaders(pat),
  });
  return res.ok;
}

export async function deleteKeyFile(
  owner: string,
  repo: string,
  pat: string,
  key: string
): Promise<boolean> {
  const url = contentsUrl(owner, repo, `${key}.txt`);
  const getRes = await fetch(url, { headers: githubHeaders(pat) });
  if (!getRes.ok) return false;

  const file = (await getRes.json()) as GitHubContentFile;
  const deleteRes = await fetch(url, {
    method: "DELETE",
    headers: {
      ...githubHeaders(pat),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Deleting ${key}.txt`,
      sha: file.sha,
      branch: "main",
    }),
  });
  return deleteRes.ok;
}

export async function createKeyFile(
  owner: string,
  repo: string,
  pat: string,
  key: string
): Promise<boolean> {
  const fileName = `${key}.txt`;
  const encoded = btoa(unescape(encodeURIComponent(key)));
  const res = await fetch(contentsUrl(owner, repo, fileName), {
    method: "PUT",
    headers: {
      ...githubHeaders(pat),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Add key ${key}`,
      content: encoded,
      branch: "main",
    }),
  });
  return res.ok;
}

export async function listKeyFiles(
  owner: string,
  repo: string,
  pat: string
): Promise<string[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/`,
    { headers: githubHeaders(pat) }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { name?: string; type?: string }[];
  return data
    .filter((x) => x.type === "file" && (x.name ?? "").toLowerCase().endsWith(".txt"))
    .map((x) => (x.name ?? "").slice(0, -4));
}

export async function createHwidFile(
  owner: string,
  repo: string,
  pat: string,
  fileName: string,
  uuidStem: string,
  key: string
): Promise<boolean> {
  const phTime = formatPhilippineTime(new Date());
  const fileContent = `# Created on ${phTime} (PH Time)\n\nKey: ${key}\n\n${uuidStem}`;
  const encoded = btoa(unescape(encodeURIComponent(fileContent)));

  const res = await fetch(contentsUrl(owner, repo, fileName), {
    method: "PUT",
    headers: {
      ...githubHeaders(pat),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Create ${fileName} with key: ${key}`,
      content: encoded,
    }),
  });
  return res.ok;
}

export async function getKeyUsedDatePH(
  owner: string,
  repo: string,
  pat: string,
  key: string,
  extensions: string[]
): Promise<string | null> {
  try {
    const query = encodeURIComponent(`"Key: ${key}" repo:${owner}/${repo}`);
    const searchRes = await fetch(
      `https://api.github.com/search/code?q=${query}&per_page=5`,
      { headers: githubHeaders(pat) }
    );
    if (!searchRes.ok) return null;

    const searchData = (await searchRes.json()) as {
      items?: { name: string; path: string }[];
    };
    const items = searchData.items ?? [];
    const extSet = new Set(extensions.map((e) => e.toLowerCase()));

    for (const item of items) {
      const name = item.name || item.path?.split("/").pop() || "";
      const lower = name.toLowerCase();
      const matched = [...extSet].some((ext) => lower.endsWith(ext));
      if (!matched) continue;

      const commitsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(name)}&per_page=1`,
        { headers: githubHeaders(pat) }
      );
      if (!commitsRes.ok) continue;

      const commits = (await commitsRes.json()) as GitHubCommit[];
      const utcIso = commits[0]?.commit?.committer?.date;
      if (utcIso) return formatPhilippineTime(new Date(utcIso));
    }

    return null;
  } catch {
    return null;
  }
}

function decodeBase64Content(content: string): string {
  const cleaned = content.replace(/\n/g, "");
  const binary = atob(cleaned);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function formatPhilippineTime(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(" ", " ");
}

function maskHwid(hwid: string): string {
  const plain = hwid.replace(/-/g, "");
  if (plain.length <= 12) return `${plain.slice(0, 4)}…`;
  return `${plain.slice(0, 8)}…${plain.slice(-4)}`;
}

function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `…${key.slice(-4)}`;
}

export async function notifyDiscord(
  webhookUrl: string,
  hwid: string,
  key: string,
  timePH: string,
  commitMessage: string
): Promise<void> {
  const content =
    `**New Registration**\n` +
    `**HWID:** \`${maskHwid(hwid)}\`\n` +
    `**Key:** \`${maskKey(key)}\`\n` +
    `**Date:** \`${timePH}\`\n` +
    `**Commit message:** ${commitMessage}`;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export function formatPhilippineTimeNow(): string {
  return formatPhilippineTime(new Date());
}
