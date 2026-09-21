"use no memo";

import { useState, useEffect, useRef } from "react";
// @ts-ignore - types depend on installed AMPS client version
import { Client, Command } from "amps";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpDown } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type TradeOrder = {
  orderNumber: string;
  trading: string;
  orderPrice: number;
  status: string;
};

const columnHelper = createColumnHelper<TradeOrder>();

const columns = [
  columnHelper.display({
    id: "select",
    enableSorting: false,
    enableColumnFilter: false,
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
      }).format(amount || 0);
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

// 1. Aapka Diya Hua AMPS Server URL
const AMPS_URL = "wss://avdvdv:9011/amps/json";
// 2. SOW Topic Name (Apne backend topic name se replace karein)
const AMPS_TOPIC = "basket_aggregated";

export function TradingTable() {
  const [data, setData] = useState<TradeOrder[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "failed"
  >("connecting");

  const [rowSelection, setRowSelection] = useState({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const tableContainerRef = useRef<HTMLDivElement>(null);

  // 3. AMPS WebSocket Connection & SOW Subscription Hook
  useEffect(() => {
    let client: any = null;
    const orderMap = new Map<string, TradeOrder>();

    async function initAmps() {
      try {
        setConnectionStatus("connecting");
        console.log(`Connecting to AMPS URL: ${AMPS_URL}...`);

        // Unique Client Name generate karein
        const clientId = `otgrid-client-${Math.random().toString(36).substring(2, 9)}`;
        client = new Client(clientId);

        await client.connect(AMPS_URL);
        setConnectionStatus("connected");
        console.log("AMPS Connected successfully!");

        // SOW snapshot + real-time subscription command
        const cmd = new Command("sow_and_subscribe")
          .topic(AMPS_TOPIC)
          .options("oof");

        await client.execute(cmd, (message: any) => {
          const raw = message.getData();
          if (!raw) return;

          const order: TradeOrder =
            typeof raw === "string" ? JSON.parse(raw) : raw;

          if (message.isOOF && message.isOOF()) {
            orderMap.delete(order.orderNumber);
          } else {
            // SOW snapshot ya live price updates ko merge karein
            orderMap.set(order.orderNumber, {
              ...orderMap.get(order.orderNumber),
              ...order,
            });
          }

          // Real-time updates ko state mein daalein
          setData(Array.from(orderMap.values()));
        });
      } catch (err) {
        console.error("AMPS Connection Error:", err);
        setConnectionStatus("failed");
      }
    }

    initAmps();

    return () => {
      if (client) {
        try {
          client.disconnect();
        } catch (e) {
          console.error("AMPS Disconnect Error:", e);
        }
      }
    };
  }, []);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => row.orderNumber, // Primary Key binding
    state: {
      rowSelection,
      sorting,
      columnFilters,
    },
  });

  const { rows } = table.getRowModel();

  // Virtualization for high-frequency incoming stream
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 50,
    overscan: 5,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start || 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() -
        (virtualRows[virtualRows.length - 1]?.end || 0)
      : 0;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold">Trading Orders Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Endpoint: {AMPS_URL}
          </p>
        </div>

        {/* Real-time Connection Status Indicator */}
        <span
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            connectionStatus === "connected"
              ? "bg-green-100 text-green-800"
              : connectionStatus === "connecting"
                ? "bg-yellow-100 text-yellow-800 animate-pulse"
                : "bg-red-100 text-red-800"
          }`}
        >
          {connectionStatus === "connected"
            ? "AMPS Live 🟢"
            : connectionStatus === "connecting"
              ? "Connecting to AMPS 🟡"
              : "AMPS Failed 🔴"}
        </span>
      </div>

      <div
        ref={tableContainerRef}
        className="rounded-md border bg-card max-h-[600px] overflow-auto relative shadow-sm"
      >
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="align-top py-3">
                    {header.isPlaceholder ? null : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center min-h-[32px]">
                          {header.column.getCanSort() ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="-ml-3 h-8 data-[state=open]:bg-accent hover:bg-muted"
                              onClick={header.column.getToggleSortingHandler()}
                            >
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                              <ArrowUpDown className="ml-2 h-4 w-4 text-muted-foreground" />
                            </Button>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )
                          )}
                        </div>
                        {header.column.getCanFilter() ? (
                          <Input
                            placeholder="Filter..."
                            value={
                              (header.column.getFilterValue() ?? "") as string
                            }
                            onChange={(event) =>
                              header.column.setFilterValue(event.target.value)
                            }
                            className="h-8 w-full min-w-[120px] text-xs font-normal"
                          />
                        ) : null}
                      </div>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px` }} />
              </tr>
            )}

            {virtualRows.length > 0 ? (
              virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-3">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {connectionStatus === "connected"
                    ? "No orders found in this SOW topic."
                    : connectionStatus === "connecting"
                      ? "Connecting and fetching SOW snapshot..."
                      : "Unable to connect to AMPS WebSocket."}
                </TableCell>
              </TableRow>
            )}

            {paddingBottom > 0 && (
              <tr>
                <td style={{ height: `${paddingBottom}px` }} />
              </tr>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex justify-between text-sm text-muted-foreground">
        <div>
          Total Orders in SOW: {rows.length} | Rendered: {virtualRows.length}
        </div>
        <div>Selected Orders: {Object.keys(rowSelection).length}</div>
      </div>
    </div>
  );
}
