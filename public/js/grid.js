// AG Grid (Community edition, MIT) set up once for ScopePay's ledgers: the
// invoice ledger and the payment pipeline. Themed to match the app.

const { createGrid, themeQuartz, ModuleRegistry, AllCommunityModule } = window.agGrid;
ModuleRegistry.registerModules([AllCommunityModule]);

export const ledgerTheme = themeQuartz.withParams({
  fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
  fontSize: 13.5,
  foregroundColor: '#17202e',
  textColor: '#17202e',
  accentColor: '#1b5fc1',
  backgroundColor: '#ffffff',
  borderColor: '#dde2e9',
  rowBorder: { color: '#ebeef2' },
  headerBackgroundColor: '#f7f8fa',
  headerTextColor: '#6b7686',
  headerFontWeight: 600,
  headerFontSize: 12.5,
  headerColumnResizeHandleColor: '#dde2e9',
  rowHoverColor: '#f8fafd',
  selectedRowBackgroundColor: '#eaf1fc',
  oddRowBackgroundColor: '#ffffff',
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  cellHorizontalPadding: 20,
  spacing: 7,
  pinnedRowBorder: { color: '#dde2e9' },
});

/** Creates a grid in `element` with ScopePay defaults. */
export function ledgerGrid(element, options) {
  return createGrid(element, {
    theme: ledgerTheme,
    domLayout: 'autoHeight',
    rowHeight: 58,
    headerHeight: 40,
    suppressCellFocus: true,
    suppressMovableColumns: true,
    animateRows: true,
    defaultColDef: { sortable: true, resizable: true, filter: true, floatingFilter: false, wrapHeaderText: true, autoHeaderHeight: true },
    overlayNoRowsTemplate: '<span class="grid-empty">Nothing to show for this filter.</span>',
    ...options,
  });
}

/** Two-line cell: main value with a muted second line. */
export const twoLine = (main, sub) => `<div class="cell-2"><span>${main}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
