import { useState } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

type TradeOrder = {
  orderNumber: string;
  trading: string;
  orderPrice: number;
  status: string;
};

const fallbackData: TradeOrder[] = [
  {
    orderNumber: "ORD-1001",
    trading: "BTC/USD",
    orderPrice: 64250.0,
    status: "Executed",
  },
  {
    orderNumber: "ORD-1002",
    trading: "ETH/USD",
    orderPrice: 3450.75,
    status: "Pending",
  },
  {
    orderNumber: "ORD-1003",
    trading: "SOL/USD",
    orderPrice: 145.2,
    status: "Cancelled",
  },
  {
    orderNumber: "ORD-1004",
    trading: "AAPL",
    orderPrice: 175.5,
    status: "Executed",
  },
  {
    orderNumber: "ORD-1005",
    trading: "TSLA",
    orderPrice: 210.0,
    status: "Pending",
  },
];

const columnHelper = createColumnHelper<TradeOrder>();

const columns = [
  // 1. Add the selection column
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() ||
          (table.getIsSomePageRowsSelected() && "indeterminate")
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
  }),
  columnHelper.accessor("orderNumber", {
    header: "Order Number",
    cell: (info) => <span className="font-medium">{info.getValue()}</span>,
  }),
  columnHelper.accessor("trading", {
    header: "Trading",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("orderPrice", {
    header: "Order Price",
    cell: (info) => {
      const amount = info.getValue();
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amount);
    },
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const status = info.getValue();
      return (
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${
            status === "Executed"
              ? "bg-green-100 text-green-700"
              : status === "Pending"
                ? "bg-yellow-100 text-yellow-700"
                : "bg-red-100 text-red-700"
          }`}
        >
          {status}
        </span>
      );
    },
  }),
];

export function TradingTable() {
  const [data] = useState(() => fallbackData);
  // 2. Add state to hold the selection memory
  const [rowSelection, setRowSelection] = useState({});

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    // 3. Wire up the selection state and row ID
    state: {
      rowSelection,
    },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.orderNumber, // THIS line prevents the AG Grid bug!
  });

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Trading Orders Dashboard</h1>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No orders found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Optional: Show how TanStack tracks the IDs in memory */}
      <div className="mt-4 text-sm text-gray-500">
        Selected Row IDs: {JSON.stringify(rowSelection)}
      </div>
    </div>
  );
}
