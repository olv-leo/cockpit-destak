import { getDatasetStatuses } from '@/lib/pbi';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const datasets = await getDatasetStatuses();
    return Response.json({ datasets });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Erro ao consultar datasets' },
      { status: 500 },
    );
  }
}
