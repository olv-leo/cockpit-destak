const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER ?? 'nj-solucoes';
const GITHUB_REPO = process.env.GITHUB_REPO ?? 'cockpit-destak';
const WORKFLOW_FILE = 'execute.yml';

export async function POST() {
  if (!GITHUB_TOKEN) {
    return Response.json({ error: 'GITHUB_TOKEN não configurado no servidor' }, { status: 500 });
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  if (res.status === 204) {
    return Response.json({ ok: true });
  }

  const error = await res.text().catch(() => 'Erro desconhecido');
  return Response.json({ error }, { status: res.status });
}
