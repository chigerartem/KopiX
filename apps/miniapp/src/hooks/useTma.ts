export function useTma() {
  const twa = window.Telegram?.WebApp;

  const initData = twa?.initData ?? "";
  const user = twa?.initDataUnsafe?.user ?? null;

  function openInvoice(url: string, callback?: (status: string) => void) {
    twa?.openInvoice(url, callback);
  }

  return { initData, user, openInvoice };
}
