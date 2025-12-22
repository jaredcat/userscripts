const MAX_ATTEMPTS = 30; // 30 seconds max wait time
let attempts = 0;

const waitForInit = setInterval(() => {
  attempts++;
  const keyList = getKeyList();
  if (keyList?.children.length) {
    clearInterval(waitForInit);
    main(keyList);
  } else if (attempts >= MAX_ATTEMPTS) {
    clearInterval(waitForInit);
    console.warn(
      'Humble Bundle Key Sort: Key list not found after maximum attempts',
    );
  }
}, 1000);

function getKeyList(): Element | null {
  return (
    document.querySelector('.content-choice-tiles') ||
    document.querySelector('.key-list')
  );
}

function isClaimed(element: Element): boolean {
  return (
    element.className.includes('claimed') ||
    element.querySelector('.redeemed') !== null
  );
}

function main(keyList: Element): void {
  const toSort = Array.from(keyList.children);

  toSort.sort((a, b) => {
    const aClaimed = isClaimed(a);
    const bClaimed = isClaimed(b);

    // Sort claimed items to the end
    if (aClaimed && !bClaimed) return 1;
    if (!aClaimed && bClaimed) return -1;

    // Both claimed or both unclaimed - sort alphabetically
    const aText = a.textContent?.trim() ?? '';
    const bText = b.textContent?.trim() ?? '';
    return aText.localeCompare(bText);
  });

  // Use replaceChildren for better performance and safety
  keyList.replaceChildren(...toSort);
}
