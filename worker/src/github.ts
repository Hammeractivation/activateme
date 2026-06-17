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
  const listRes = await fetch(contentsUrl(owner, repo, ""), {
    headers: githubHeaders(pat),
  });
  if (!listRes.ok) return null;

  const files = (await listRes.json()) as GitHubContentFile[];
  const extSet = new Set(extensions.map((e) => e.toLowerCase()));

  for (const file of files) {
    const lower = file.name.toLowerCase();
    const matched = [...extSet].some((ext) => lower.endsWith(ext));
    if (!matched) continue;

    const fileRes = await fetch(contentsUrl(owner, repo, file.name), {
      headers: githubHeaders(pat),
    });
    if (!fileRes.ok) continue;

    const fileData = (await fileRes.json()) as GitHubContentFile;
    if (!fileData.content) continue;

    const decoded = decodeBase64Content(fileData.content);
    if (!decoded.toLowerCase().includes(`key: ${key.toLowerCase()}`)) continue;

    const commitsRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(file.name)}`,
      { headers: githubHeaders(pat) }
    );
    if (!commitsRes.ok) return null;

    const commits = (await commitsRes.json()) as GitHubCommit[];
    const utcIso = commits[0]?.commit?.committer?.date;
    if (!utcIso) return null;

    return formatPhilippineTime(new Date(utcIso));
  }

  return null;
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

export async function notifyDiscord(
  webhookUrl: string,
  hwid: string,
  key: string,
  timePH: string,
  commitMessage: string
): Promise<void> {
  const content =
    `**New Registration**\n` +
    `**HWID:** \`${hwid}\`\n` +
    `**Key:** \`${key}\`\n` +
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
