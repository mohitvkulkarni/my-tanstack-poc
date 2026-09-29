import { createColumnHelper, type CellContext } from "@tanstack/react-table";

// message.header carries the AMPS envelope metadata (command, topic, subIds, ...
export type BasketOrder = {
  listID?: string;
  deskID?: string;
  transactTime?: string;
  listName?: string;
  ric?: string;
  username?: string;
  ordStatus?: string;
  basketSide?: string;
  totalUnit?: number;
  pctWaved?: number;
  pctExec?: number;
  pctUnwaved?: number;
  pctSSRestricted?: number;
  execPx?: number;
  usdOrd?: number;
  usdLive?: number;
  usdExec?: number;
  usdAvail?: number;
  usdRejected?: number;
  usdNonTrd?: number;
  usdCanceled?: number;
  usdPending?: number;
  usdPendingCancel?: number;
  usdPendingLocate?: number;
  fxRate?: number;
  numOrders?: number;
  numPendingLocate?: number;
  createDate?: string;
  createTime?: string;
  ioiStatus?: string;
  usdInit?: number;
  usdNotionalTotal?: number;
  usdCash?: number;
  usdHalted?: number;
  usdSSRestricted?: number;
  totalQty?: number;
  nonTrdQty?: number;
  ordQty?: number;
  availQty?: number;
  liveQty?: number;
  cumQty?: number;
  unExecQty?: number;
  rejQty?: number;
  cxlQty?: number;
  pendQty?: number;
  pendCxlQty?: number;
  pendLocQty?: number;
  securityDesc?: string;
  restrictedCategory?: string;
  bbg?: string;
  usdInitBuy?: number;
  usdInitSell?: number;
  usdNotionalExecBuy?: number;
  usdNotionalExecSell?: number;
  usdNotionalUnexec?: number;
  numCanceled?: number;
  numFilled?: number;
  numPendingCxl?: number;
  execUnit?: number;
  unexecUnit?: number;
  execAtLast?: number;
  execAtBid?: number;
  execAtMid?: number;
  execAtAsk?: number;
  execAtPrevClose?: number;
  ccy?: string;
  tradingAccount?: string;
  iNavAchvd?: number;
  iNavExp?: number;
  benchmark?: number;
  numHalted?: number;
  numSSRestricted?: number;
  doNotTrade?: number;
};

// One row rendered in the table: the business record plus the SQL key (from ...
export type MessageRow = BasketOrder & {
  key: string;
  __loading?: boolean;
};

export const AMPS_URL =
  "wss://lrdeqotap01u.eur.nsroot.net:9011/amps/json";

// apac "wss://lhkeqotap4u.apac.nsroot.net:9011/amps/json";

export const AMPS_TOPIC = "basket_aggregated";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number | undefined | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return currencyFormatter.format(value);
}

export function formatPercent(value: number | undefined | null) {
  if (value === undefined || value === null || Number.isNaN(value)) return "";
  return `${value.toFixed(2)}%`;
}

export function formatNumber(
  value: number | undefined | null,
  decimals = 0
) {
  if (value === undefined || value === null || Number.isNaN(value)) return "";

  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const columnHelper = createColumnHelper<MessageRow>();

// Maps an order status to its badge colour classes. Extracted to a lookup so ...
const ORDER_STATUS_BADGE_CLASSES: Record<string, string> = {
  FILLED: "bg-green-100 text-green-700",
  NEW: "bg-yellow-100 text-yellow-700",
};

function orderStatusBadgeClass(status: string): string {
  return ORDER_STATUS_BADGE_CLASSES[status] ?? "bg-red-100 text-red-700";
}

// Shared cell renderers -- most columns below just right-align a formatted ...
type NumericCell = CellContext<MessageRow, number | undefined>;
type TextCell = CellContext<MessageRow, string | undefined>;

function currencyCell(info: NumericCell) {
  return (
    <span className="block text-right">
      {formatCurrency(info.getValue())}
    </span>
  );
}

function numberCell(decimals = 0) {
  return (info: NumericCell) => (
    <span className="block text-right">
      {formatNumber(info.getValue(), decimals)}
    </span>
  );
}

function percentCell(info: NumericCell) {
  return (
    <span className="block text-right">
      {formatPercent(info.getValue())}
    </span>
  );
}

function monoCell(info: TextCell) {
  return (
    <span className="font-mono text-xs">
      {info.getValue()}
    </span>
  );
}

function plainCell(info: TextCell) {
  return info.getValue();
}

// `usdNetTotal` isn't published as its own field on the `basket_aggregated` ...
function computeNetTotal(row: MessageRow): number | undefined {
  if (
    row.usdNotionalTotal === undefined ||
    row.usdNotionalTotal === null
  ) {
    return undefined;
  }

  const sign = row.basketSide === "BUY" ? 1 : -1;
  return sign * row.usdNotionalTotal;
}

// Same idea as `computeNetTotal`, but signing the *executed* notional.
function computeNetExec(row: MessageRow): number | undefined {
  if (row.usdExec === undefined || row.usdExec === null) {
    return undefined;
  }

  const sign = row.basketSide === "BUY" ? 1 : -1;
  return sign * row.usdExec;
}

export const columns = [
  columnHelper.accessor("deskID", {
    header: "Desk ID",
    cell: (info) =>
      info.row.original.__loading ? (
        <span className="inline-block h-3 w-16 animate-pulse rounded bg-muted" />
      ) : (
        info.getValue()
      ),
  }),

  columnHelper.accessor("transactTime", {
    header: "Create DateTime",
    cell: monoCell,
  }),

  columnHelper.accessor("listName", {
    header: "Name",
    cell: plainCell,
  }),

  columnHelper.accessor("ric", {
    header: "RIC",
    cell: plainCell,
  }),

  columnHelper.accessor("usdOrd", {
    header: "$ Ord",
    cell: currencyCell,
  }),

  columnHelper.accessor("username", {
    header: "Trader",
    cell: (info) => (
      <span className="font-medium">{info.getValue()}</span>
    ),
  }),

  columnHelper.accessor("ordStatus", {
    header: "Status",
    cell: (info) => {
      const status = info.getValue();

      if (!status) return null;

      return (
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${orderStatusBadgeClass(
            status
          )}`}
        >
          {status}
        </span>
      );
    },
  }),

  columnHelper.accessor(computeNetTotal, {
    id: "usdNetTotal",
    header: "$ Net Total",
    cell: currencyCell,
  }),

  columnHelper.accessor(computeNetExec, {
    id: "usdNetExec",
    header: "$ Net Exec",
    cell: currencyCell,
  }),

  columnHelper.accessor("totalUnit", {
    header: "Total Unit",
    cell: numberCell(),
  }),

  columnHelper.accessor("pctWaved", {
    header: "% Waved",
    cell: percentCell,
  }),

  columnHelper.accessor("pctExec", {
    header: "% Exec",
    cell: percentCell,
  }),

  columnHelper.accessor("pctUnwaved", {
    header: "% Unwaved",
    cell: percentCell,
  }),

  columnHelper.accessor("pctSSRestricted", {
    header: "% SS Restricted",
    cell: percentCell,
  }),

  columnHelper.accessor("execPx", {
    header: "Exec Px",
    cell: numberCell(4),
  }),

  columnHelper.accessor("usdLive", {
    header: "$ Live",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdExec", {
    header: "$ Exec",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdAvail", {
    header: "$ Avail",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdRejected", {
    header: "$ Rejected",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdNonTrd", {
    header: "$ NonTrd",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdCanceled", {
    header: "$ Cxl",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdPending", {
    header: "$ Pend",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdPendingCancel", {
    header: "$ Pend Cxl",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdPendingLocate", {
    header: "$ Pend Loc",
    cell: currencyCell,
  }),

  columnHelper.accessor("fxRate", {
    header: "FX Rate",
    cell: numberCell(4),
  }),

  columnHelper.accessor("numOrders", {
    header: "# Ords",
    cell: numberCell(),
  }),

  columnHelper.accessor("numPendingLocate", {
    header: "# Pend Loc",
    cell: numberCell(),
  }),

  columnHelper.accessor("createDate", {
    header: "Create Date",
    cell: monoCell,
  }),

  columnHelper.accessor("createTime", {
    header: "Create Time",
    cell: monoCell,
  }),

  columnHelper.accessor("listID", {
    header: "ID",
    cell: plainCell,
  }),

  columnHelper.accessor("ioiStatus", {
    header: "IOI Status",
    cell: plainCell,
  }),

  columnHelper.accessor("usdInit", {
    header: "$ Init",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdNotionalTotal", {
    header: "$ Total",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdCash", {
    header: "$ Cash",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdHalted", {
    header: "$ Halted",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdSSRestricted", {
    header: "$ SS Restricted",
    cell: currencyCell,
  }),

  columnHelper.accessor("totalQty", {
    header: "Total Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("nonTrdQty", {
    header: "NonTrd Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("ordQty", {
    header: "Ord Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("availQty", {
    header: "Avail Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("liveQty", {
    header: "Live Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("cumQty", {
    header: "Exec Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("unExecQty", {
    header: "Unexec Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("rejQty", {
    header: "Rej Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("cxlQty", {
    header: "Cxl Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("pendQty", {
    header: "Pend Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("pendCxlQty", {
    header: "Pend Cxl Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("pendLocQty", {
    header: "Pend Loc Qty",
    cell: numberCell(),
  }),

  columnHelper.accessor("securityDesc", {
    header: "Security Desc",
    cell: plainCell,
  }),

  columnHelper.accessor("restrictedCategory", {
    header: "Restrictions",
    cell: plainCell,
  }),

  columnHelper.accessor("bbg", {
    header: "BBG",
    cell: plainCell,
  }),

  columnHelper.accessor("usdInitBuy", {
    header: "$ Init Buy",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdInitSell", {
    header: "$ Init Sell",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdNotionalExecBuy", {
    header: "$ Exec Buy",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdNotionalExecSell", {
    header: "$ Exec Sell",
    cell: currencyCell,
  }),

  columnHelper.accessor("usdNotionalUnexec", {
    header: "$ Unexec",
    cell: currencyCell,
  }),

  columnHelper.accessor("numCanceled", {
    header: "# Cxl",
    cell: numberCell(),
  }),

  columnHelper.accessor("numFilled", {
    header: "# Fild",
    cell: numberCell(),
  }),

  columnHelper.accessor("numPendingCxl", {
    header: "# Pnd Cxl",
    cell: numberCell(),
  }),

  columnHelper.accessor("execUnit", {
    header: "Exec Unit",
    cell: numberCell(),
  }),

  columnHelper.accessor("unexecUnit", {
    header: "Unexec Unit",
    cell: numberCell(),
  }),

  // execAtLast / execAtBid / execAtMid / execAtAsk / execAtPrevClose,
  // iNavExp, benchmark, numHalted and doNotTrade columns are disabled --
  // re-add with `cell: numberCell()` (or `numberCell(2)` for the iNav ones)
  // if they need to be surfaced again.

  columnHelper.accessor("ccy", {
    header: "CCY",
    cell: plainCell,
  }),

  columnHelper.accessor("tradingAccount", {
    header: "Trading Account",
    cell: plainCell,
  }),

  columnHelper.accessor("iNavAchvd", {
    header: "iNav Achvd",
    cell: numberCell(2),
  }),

  columnHelper.accessor("numSSRestricted", {
    header: "# SS Restricted",
    cell: numberCell(),
  }),
];
