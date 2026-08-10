interface EpixTools {
  init(): void;
  addToolbar(): void;
  addKeyboardShortcuts(): void;
}

const AUTO_COLLECT_INTERVAL_MS = 5000;

class GamescomEpixTools implements EpixTools {
  private toolbar: HTMLDivElement | undefined = undefined;
  private autoCollectInterval: ReturnType<typeof setInterval> | undefined =
    undefined;

  private setup(): void {
    this.addToolbar();
    this.addKeyboardShortcuts();
    this.observePageChanges();
  }

  private quickJoinQueue(): void {
    const joinButton = document.querySelector<HTMLButtonElement>(
      'button[data-testid="join-queue-button"]',
    );
    joinButton?.click();
  }

  private skipCurrentVideo(): void {
    const skipButton = document.querySelector<HTMLButtonElement>(
      'button[data-testid="skip-video-button"]',
    );
    skipButton?.click();
  }

  private toggleAutoCollect(): void {
    if (this.autoCollectInterval) {
      clearInterval(this.autoCollectInterval);
      this.autoCollectInterval = undefined;
      console.log('Auto-collect disabled');
    } else {
      this.autoCollectInterval = setInterval(() => {
        const collectButtons = document.querySelectorAll<HTMLButtonElement>(
          'button[data-testid="collect-reward-button"]',
        );
        for (const button of collectButtons) {
          button.click();
        }
      }, AUTO_COLLECT_INTERVAL_MS);
      console.log('Auto-collect enabled');
    }
  }

  private observePageChanges(): void {
    const observer = new MutationObserver(() => {
      // Re-run any necessary functions when the page content changes
      if (!this.autoCollectInterval) {
        return;
      }

      const collectButtons = document.querySelectorAll<HTMLButtonElement>(
        'button[data-testid="collect-reward-button"]',
      );
      for (const button of collectButtons) {
        button.click();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  public init(): void {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.setup());
    } else {
      this.setup();
    }
  }

  public addToolbar(): void {
    this.toolbar = document.createElement('div');
    this.toolbar.className = 'epix-tools-toolbar';
    this.toolbar.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.8);
      padding: 10px;
      border-radius: 5px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 5px;
    `;

    const buttons = [
      {
        text: 'Quick Join Queue',
        action: () => this.quickJoinQueue(),
        hotkey: 'J',
      },
      {
        text: 'Skip Current Video',
        action: () => this.skipCurrentVideo(),
        hotkey: 'S',
      },
      {
        text: 'Auto-Collect Rewards',
        action: () => this.toggleAutoCollect(),
        hotkey: 'R',
      },
    ];

    for (const { text, action, hotkey } of buttons) {
      const button = document.createElement('button');
      button.textContent = `${text} (${hotkey})`;
      button.style.cssText = `
        padding: 5px 10px;
        margin: 2px;
        border: none;
        border-radius: 3px;
        background: #4a4a4a;
        color: white;
        cursor: pointer;
      `;
      button.addEventListener('click', action);
      this.toolbar?.append(button);
    }

    document.body.append(this.toolbar);
  }

  public addKeyboardShortcuts(): void {
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return; // Ignore if typing in input

      switch (event.key.toUpperCase()) {
        case 'J': {
          this.quickJoinQueue();
          break;
        }
        case 'S': {
          this.skipCurrentVideo();
          break;
        }
        case 'R': {
          this.toggleAutoCollect();
          break;
        }
      }
    });
  }
}

// Initialize the tools
const app = new GamescomEpixTools();
app.init();
