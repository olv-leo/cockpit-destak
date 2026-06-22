import { getDatasetStatuses } from '@/lib/pbi';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const datasets = await getDatasetStatuses();
    console.log('[PBI datasets]', datasets.map(d => `${d.name}: ${d.lastRefresh?.status ?? 'null'}`));
    return Response.json({ datasets });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Erro ao consultar datasets' },
      { status: 500 },
    );
  }
}
