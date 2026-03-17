export function getEffectiveDate(timezone: string) {
  const now = new Date();

  const local = new Date(
    now.toLocaleString("en-US", { timeZone: timezone })
  );

  if (local.getHours() < 2) {
    local.setDate(local.getDate() - 1);
  }

  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, "0");
  const dd = String(local.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
}