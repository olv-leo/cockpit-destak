const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER ?? 'nj-solucoes';
const GITHUB_REPO = process.env.GITHUB_REPO ?? 'cockpit-destak';
const WORKFLOW_FILE = 'execute.yml';

export async function GET() {
  if (!GITHUB_TOKEN) {
    return Response.json([], { status: 200 });
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=10`;

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    return Response.json([], { status: 200 });
  }

  const data = await res.json();
  const runs = (data.workflow_runs ?? []).map((run: {
    id: number;
    status: string;
    conclusion: string | null;
    created_at: string;
    updated_at: string;
    html_url: string;
  }) => ({
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
  }));

  return Response.json(runs);
}
