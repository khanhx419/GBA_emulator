// Screen Filters & Shaders for GBA Canvas

export class GBAShaders {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    this.currentFilter = 'lcd'; // 'pixel', 'lcd', 'crt', 'vivid'
    this.setFilter(this.currentFilter);
  }

  setFilter(filterName) {
    this.currentFilter = filterName;
    if (!this.container) return;

    this.container.classList.remove('filter-pixel', 'filter-lcd', 'filter-crt', 'filter-vivid');

    switch (filterName) {
      case 'pixel':
        this.container.classList.add('filter-pixel');
        break;
      case 'lcd':
        this.container.classList.add('filter-lcd');
        break;
      case 'crt':
        this.container.classList.add('filter-crt');
        break;
      case 'vivid':
        this.container.classList.add('filter-vivid');
        break;
      default:
        this.container.classList.add('filter-pixel');
    }
  }
}
