import prisma from '../prisma';

// Atomic case number generator (e.g. DSP-2026-000125). A single `upsert` with
// `value: { increment: 1 }` compiles to one atomic UPDATE in Postgres, so two students filing at
// the same moment can never be handed the same number — no Redis or DB sequence object needed.
export async function generateCaseNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const counterId = `dispute-${year}`;
  const counter = await prisma.sequenceCounter.upsert({
    where: { id: counterId },
    create: { id: counterId, value: 1 },
    update: { value: { increment: 1 } },
  });
  return `DSP-${year}-${String(counter.value).padStart(6, '0')}`;
}
