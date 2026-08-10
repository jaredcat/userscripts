const MAX_ATTEMPTS = 30; // 30 seconds max wait time
const POLL_INTERVAL_MS = 1000;
const state = { attempts: 0 };

const waitForInit = setInterval(() => {
  state.attempts++;
  const keyList = getKeyList();
  if (keyList?.children.length) {
    clearInterval(waitForInit);
    main(keyList);
  } else if (state.attempts >= MAX_ATTEMPTS) {
    clearInterval(waitForInit);
    console.warn(
      'Humble Bundle Key Sort: Key list not found after maximum attempts',
    );
  }
}, POLL_INTERVAL_MS);

function getKeyList(): Element | undefined {
  return (
    document.querySelector('.content-choice-tiles') ||
    document.querySelector('.key-list') ||
    undefined
  );
}

function isClaimed(element: Element): boolean {
  return (
    element.className.includes('claimed') ||
    Boolean(element.querySelector('.redeemed'))
  );
}

function main(keyList: Element): void {
  const toSort = [...keyList.children];

  toSort.sort((a, b) => {
    const isAClaimed = isClaimed(a);
    const isBClaimed = isClaimed(b);

    // Sort claimed items to the end
    if (isAClaimed && !isBClaimed) return 1;
    if (!isAClaimed && isBClaimed) return -1;

    // Both claimed or both unclaimed - sort alphabetically
    const aText = a.textContent?.trim() ?? '';
    const bText = b.textContent?.trim() ?? '';
    return aText.localeCompare(bText);
  });

  // Use replaceChildren for better performance and safety
  keyList.replaceChildren(...toSort);
}
