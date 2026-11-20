export interface Guide { slug: string; title: string; audience: string; summary: string; sections: { h: string; steps?: string[]; p?: string }[] }

export const GUIDES: Guide[] = [
  {
    slug: 'guests', title: 'Ordering at your table (for guests)', audience: 'Guests', summary: 'Scan, order, track, ask for help and pay — no app or account needed.',
    sections: [
      { h: 'Start ordering', steps: ['Point your phone camera at the QR code on your table and open the link.', 'Enter your name. Your phone number is optional — add it if you want the restaurant to recognise you next time.', 'Browse the menu by category, tap an item, choose size, extras and notes, then add it to your order.'] },
      { h: 'Send and track your order', steps: ['Open “Your order”, check quantities and tap Send order.', 'If the restaurant approves orders, you will see “Waiting for confirmation” first.', 'Watch the status bar: Accepted → Preparing → Ready → Served, with an estimated time.'] },
      { h: 'Change your order', p: 'You can edit a just-sent order for a few minutes (the restaurant decides how long). After that, use “Add more items” — extras are added to the same bill.' },
      { h: 'If you close the browser', p: 'Simply scan the same QR again. Your order and bill come back. A friend at your table can join by entering the 4-digit table PIN shown on your screen.' },
      { h: 'Get help', steps: ['Tap the help button (bottom right) at any time.', 'Call a waiter, ask for billing help, send a chat message or start a voice call (your browser will ask for microphone permission).', 'If a call cannot connect, you will be offered the restaurant’s phone number or a call-back request.'] },
      { h: 'Pay your bill', steps: ['Open Bill to see every item, discount and each tax separately.', 'Choose a payment method. For bank/wallet transfers, pay in your banking app and upload the screenshot.', 'Or tap “Pay cash” — a staff member will come to collect.', 'Your bill shows “Under review” until staff confirm the payment.'] },
      { h: 'Your privacy', p: 'Only your name is required. Recognition and marketing are off unless you tick them. Ask the restaurant if you want your profile deleted.' },
    ],
  },
  {
    slug: 'restaurant-admins', title: 'Getting started for restaurant owners and admins', audience: 'Owners & admins', summary: 'From registration to your first service: settings, menu, taxes, tables, staff and payments.',
    sections: [
      { h: '1. Register and activate', steps: ['Click Get started, enter your restaurant details, currency and timezone, create the owner login and sign the platform agreement.', 'Go to Subscription, choose a plan, pay using the instructions and upload the payment screenshot.', 'The platform team approves your registration and payment; you will be notified.'] },
      { h: '2. Restaurant settings', steps: ['Settings → General: address, contact details, locale, Wi-Fi details.', 'Settings → Ordering & kitchen and Online & delivery: approval required, customer edit window (0 disables editing), stock deduction trigger, online ordering, delivery charge, minimum order and opening hours.', 'Settings → Calls & support: choose which roles or staff receive guest voice calls and a fallback phone number.'] },
      { h: '3. Taxes and payment methods', steps: ['Taxes: add each tax (e.g. GST, VAT, service charge). Choose percentage or fixed, inclusive or exclusive, which items/categories/order types it applies to, and whether it is optional and selected by default.', 'Mark taxes you collect for the government as “liability” so they are excluded from revenue and profit. Uncheck it only for charges the restaurant keeps (e.g. a service charge).', 'Payment methods: add bank accounts, wallets or QR images guests can pay to.'] },
      { h: '4. Menu', steps: ['Kitchen stations: create Pizza, Grill, Drinks, Desserts or your own.', 'Categories: assign a default station and preparation time.', 'Items: name, description, price, photo, allergens, preparation time; then add variants (sizes) and add-ons.', 'Toggle availability instantly from the menu list or the kitchen screen.'] },
      { h: '5. Tables and QR codes', steps: ['Tables: add tables with number, capacity, area and assigned waiter.', 'Open a table’s QR to download or print it. Regenerate if a code is lost — the old one stops working.', 'Tables & QR page: download the restaurant-wide online ordering QR for flyers and social media, and a separate Wi-Fi QR.'] },
      { h: '6. Staff', steps: ['Staff: invite managers, cashiers, waiters, kitchen and inventory staff with a role.', 'Roles: adjust permissions or create custom roles. You can only grant permissions you hold.', 'Disable an account to sign the person out everywhere immediately.', 'Forgotten password: staff can use “Forgot password?” on the sign-in page (when email is set up), or you can set a new password from their Staff entry. Owners who are locked out can ask platform support for a one-time reset link.'] },
      { h: '7. Inventory (optional but recommended)', steps: ['Ingredients: add stock items with units and minimum levels; record opening stock.', 'Recipes: for each menu item list ingredient quantities, yield and wastage allowance.', 'Purchases: record deliveries with supplier, quantities, unit costs and extra charges.'] },
      { h: '8. Your website', p: 'Website: pick a theme, colours, fonts and sections (hero, featured, menu, gallery, reviews, hours, contact, reservations). Save the draft, preview it, then publish.' },
      { h: 'Daily routine', steps: ['Open the POS shift with opening cash.', 'Watch Orders, Kitchen and Support during service.', 'Approve payment proofs in Billing → Pending payments.', 'Close the shift and review the dashboard and reports.'] },
    ],
  },
  {
    slug: 'waiters', title: 'Waiter app guide', audience: 'Waiters', summary: 'Tables, ready orders, requests, tasks and creating orders for guests.',
    sections: [
      { h: 'Your screen', p: 'Open Waiter on your phone. You see your tables, ready-to-serve orders, open requests and tasks. New items arrive in real time with a sound.' },
      { h: 'Serve ready orders', steps: ['When the kitchen marks an order ready it appears under Ready.', 'Deliver it and tap Mark served.'] },
      { h: 'Handle requests', steps: ['Requests show the table and type (waiter, billing, cash collection, call-back).', 'Tap Acknowledge when you are on your way and Resolve when done.'] },
      { h: 'Order for a guest without a smartphone', steps: ['Tap New order, choose the table and enter the guest’s name.', 'Add items, variants and notes, then send. It goes straight to the kitchen.', 'To add more later, open the order and choose Add items.'] },
      { h: 'Tasks', p: 'Managers can assign tasks such as “Please visit table 2”. Accept, start and complete them so your manager can see progress. Use Report issue for broken equipment or table problems.' },
    ],
  },
  {
    slug: 'kitchen', title: 'Kitchen display guide', audience: 'Kitchen staff', summary: 'Stations, tickets, timers and marking items ready.',
    sections: [
      { h: 'Choose your station', p: 'Open Kitchen and select your station(s). Each ticket shows only the items for those stations.' },
      { h: 'Working tickets', steps: ['New tickets appear on the left with a sound (toggle sound in the header).', 'Tap Start when you begin — the order shows as Preparing to the guest.', 'Tap Ready when your part is done. When all stations are ready, the order becomes Ready and waiters are notified.'] },
      { h: 'Timers and delays', p: 'The timer counts from when the ticket arrived. Tickets past their estimate or the delay threshold turn red. Priority tickets have an orange edge.' },
      { h: '86 an item', p: 'If you run out, tap the item in Menu → availability (or ask a manager). It disappears from guest menus immediately.' },
      { h: 'Record wastage', p: 'Use Wastage to record dropped, expired or damaged items. A manager approves it and stock is updated.' },
    ],
  },
  {
    slug: 'pos', title: 'POS counter guide', audience: 'Cashiers', summary: 'Shifts, sales, discounts, split bills, refunds and receipts.',
    sections: [
      { h: 'Open your shift', p: 'Enter your opening cash. All cash you take and refund is tracked against your shift.' },
      { h: 'Make a sale', steps: ['Search or tap items; choose variants and add-ons.', 'Pick the order type: dine-in (choose a table), takeaway or pickup.', 'Apply a discount or coupon if permitted and select optional taxes.', 'Tap Charge, add one or more payments (cash, card, bank, wallet). Enter cash tendered to see change.', 'The bill closes automatically when fully paid. Print the receipt.'] },
      { h: 'Hold and resume', p: 'Tap Hold to park an order without sending it to the kitchen. Open Held to resume it later.' },
      { h: 'Split a bill', p: 'From the bill, choose Split: equally, by items, or custom amounts. Record each part as a separate payment.' },
      { h: 'Refunds and reprints', p: 'Open a closed bill from Billing to reprint or refund (requires permission). Choose whether to return ingredients to stock.' },
      { h: 'Close your shift', p: 'Count the drawer and enter the amount. The system shows expected cash and any difference; differences are reported to managers.' },
    ],
  },
  {
    slug: 'printers', title: 'Printer setup and supported hardware', audience: 'Admins', summary: 'Browser, USB, Bluetooth and network thermal printers.',
    sections: [
      { h: 'Add a printer', steps: ['Setup → Printers → New.', 'Choose connection, paper width (58 or 80 mm), characters per line (32 for 58 mm, 48 for 80 mm typically) and encoding.', 'Tap Test print and confirm the status shows OK.'] },
      { h: 'Browser printing (all devices)', p: 'Uses the system print dialog with a receipt-sized page. Works with any printer installed on the device, including thermal printers with OS drivers. Set the default printer and margins to “none” in the dialog for best results.' },
      { h: 'USB (WebUSB)', p: 'Chrome or Edge on Windows, macOS, Linux, ChromeOS or Android, over HTTPS. Works with ESC/POS printers that expose a USB bulk endpoint. On Windows, a vendor driver may claim the device — use the WinUSB driver (e.g. via Zadig) or use browser printing instead. Safari and Firefox do not support WebUSB.' },
      { h: 'Bluetooth (Web Bluetooth)', p: 'Chrome on Android, Windows, macOS and ChromeOS. Works with Bluetooth Low Energy (BLE) thermal printers. Classic Bluetooth (SPP-only) printers are not reachable from browsers — use the print bridge or browser printing with the OS driver. iOS browsers do not support Web Bluetooth.' },
      { h: 'Network printers (LAN, port 9100)', steps: ['Browsers cannot open raw TCP connections, so run the included print bridge on a computer in the restaurant: node scripts/print-bridge.mjs', 'Set the printer address to IP:port (e.g. 192.168.1.50:9100).', 'The bridge only listens on 127.0.0.1 and only forwards to private-network addresses.'] },
      { h: 'Troubleshooting', p: 'Garbled characters: switch encoding to cp437 or cp858. Cut-off lines: lower characters per line. Nothing prints: check status, cable/pairing, and that the page is on HTTPS for USB/Bluetooth.' },
    ],
  },
  {
    slug: 'inventory-and-costing', title: 'Inventory, recipes and food cost', audience: 'Inventory managers', summary: 'Keep stock accurate and understand margins.',
    sections: [
      { h: 'Stock items', p: 'Each ingredient has a unit, current quantity, minimum level and weighted-average cost. Change quantities only through purchases, adjustments, transfers, returns or wastage — every change is recorded.' },
      { h: 'Purchases', p: 'Record supplier deliveries with quantities, unit costs and extra charges (delivery, packaging). Extra charges are spread into the landed unit cost.' },
      { h: 'Recipes', p: 'List ingredient quantities per menu item (and per variant if sizes differ). Yield divides the batch; wastage allowance adds a percentage for trimming and spillage.' },
      { h: 'Automatic deduction', p: 'Choose the trigger in Settings: when an order is submitted, accepted, ready or completed. Cancelling an order puts the ingredients back.' },
      { h: 'Counts and adjustments', p: 'Use “Count” to set the real quantity after a stock-take — the difference is posted as a stock adjustment.' },
      { h: 'Food cost reports', p: 'Estimated cost uses the current recipe; actual food cost uses what was really consumed. Items above 35% food cost are flagged.' },
    ],
  },
  {
    slug: 'finance-and-reports', title: 'Finance, taxes and reports', audience: 'Owners & accountants', summary: 'How numbers are calculated and how to export them.',
    sections: [
      { h: 'How revenue is recognised', p: 'Revenue is recorded when a bill is closed. Payments received earlier are customer deposits. Open, unpaid bills are not revenue. Taxes marked as liabilities are never revenue.' },
      { h: 'Expenses and payroll', p: 'Record expenses (or set them as recurring). Payroll entries are generated monthly for staff with a salary; add bonuses, deductions and advances, then mark paid.' },
      { h: 'Wastage and complimentary items', p: 'Approved wastage and complimentary items reduce stock and are expensed at cost. Complimentary items never count as sales.' },
      { h: 'Billing errors', p: 'Record discrepancies as a loss (reduces profit) or as neutral (kept aside, does not change profit) until resolved. Changes are audited.' },
      { h: 'Reports', p: 'Sales, revenue, expenses, P&L, cash, payment reconciliation, tax, inventory, valuation, purchases, food cost, recipe profitability, wastage, complimentary, payroll, employees, customers, loyalty, reservations, orders, kitchen and branches. Filter by date, branch, employee, payment method, order type, category or item; export to PDF or Excel with exact values.' },
    ],
  },
  {
    slug: 'super-admin', title: 'Super Admin guide', audience: 'Platform owner', summary: 'Approvals, subscriptions, branding, agreements, backups and reports.',
    sections: [
      { h: 'Approve restaurants', p: 'Restaurants → Pending. Review details and the signed agreement, then Approve or Reject with a reason.' },
      { h: 'Subscriptions', p: 'Payments → review each screenshot, Approve (extends the subscription by the plan duration from the later of now or the current expiry) or Reject with a reason. Configure plans, grace period, reminders, retention, bank accounts and instructions in Settings.' },
      { h: 'Suspend / reactivate', p: 'Suspending immediately signs out staff, blocks ordering pages and QR codes, and schedules deletion after the retention period. Only you can reactivate.' },
      { h: 'Deletion', p: 'Scheduled deletions run only if you approve them for the restaurant, or if auto-delete is enabled. A final export is always created first.' },
      { h: 'Branding', p: 'Settings → Branding: software name, logo, favicon, colours, support details, footer, legal links and email sender. Changes apply across the site, dashboards, receipts, PDFs, Excel exports and emails within a minute.' },
      { h: 'Agreements', p: 'Publish a new version. If marked material, restaurants are asked to re-accept it.' },
      { h: 'Operations', p: 'Backups (database and storage, verified with checksums), job history, audit logs and demo requests.' },
    ],
  },
];
