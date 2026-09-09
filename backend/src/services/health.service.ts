export function getHealth() {
  return { status: 'ok', service: 'booklens-api' } as const;
}
