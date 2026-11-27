// Writes files to a GitHub repo through the Contents API, as GITHUB_TOKEN (a fine-grained token that can write that
// repo's contents). Used for the az-ho.me listing pages.

// Creates the file, or replaces it if it's already there
export async function putGithubFile(repo, path, text, message) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const url = `https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'portal-api' };
  const existing = await fetch(url, { headers });
  const sha = existing.ok ? (await existing.json()).sha : undefined;
  const res = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ message, content: Buffer.from(text).toString('base64'), sha }) });
  if (!res.ok) throw new Error(`GitHub PUT ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
