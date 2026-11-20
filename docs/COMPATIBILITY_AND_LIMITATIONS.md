# Compatibility and Known Limitations

## Browsers

| Use | Supported |
|---|---|
| Guests (QR, online ordering) | Last 2 versions of Safari iOS 15+, Chrome Android 9+, Samsung Internet, Firefox, Edge. No app install needed. |
| Staff dashboard, POS, KDS, waiter | Chrome or Edge (recommended), Safari 16+, Firefox (latest). Minimum width 360 px for the waiter view; 1024 px+ for POS and KDS. |
| Voice calls | Any browser with WebRTC and microphone access over HTTPS: Chrome, Edge, Firefox, Safari 15+. In-app browsers (Instagram, Facebook) may block the microphone, so guests should open the page in the real browser. |
| USB printing (WebUSB) | Chrome or Edge on desktop, ChromeOS and Android. **Not** Safari, Firefox or any iOS browser. |
| Bluetooth printing (Web Bluetooth) | Chrome on Android, Windows, macOS and ChromeOS, BLE printers only. **Not** iOS. |

## Printers

| Connection | Works with | Notes |
|---|---|---|
| Browser print | Any printer with an OS driver | The most compatible option. Set margins to none and a receipt-sized paper. |
| USB | ESC/POS printers exposing a USB bulk endpoint (most Epson TM, Xprinter, Rongta, HPRT models) | On Windows a vendor driver may claim the device. Use WinUSB (Zadig) or browser print. |
| Bluetooth | BLE ESC/POS printers | Classic Bluetooth SPP-only printers are not reachable from browsers. Use the OS driver plus browser print, or a network printer. |
| Network (LAN 9100) | Any ESC/POS network printer | Requires the included print bridge (`npm run print-bridge`) on a computer in the restaurant. It listens on localhost and forwards only to private IPs. |

Paper widths: 58 mm (32 characters) and 80 mm (48 characters); any width from 24 to 64 characters can be configured.

Encodings:
- **CP437**, the default
- **CP858**, Western European accents plus the € sign
- **UTF-8**, for modern printers that support it

Accented Latin characters are mapped to the printer's code page, and anything the code page cannot show is transliterated (for example ā → a) or printed as `?`.

Non-Latin scripts (Arabic, Urdu, Sindhi, Chinese and others) are not available in ESC/POS code pages. For those languages, use **browser print**, which renders any Unicode text through the OS driver. The A4 **PDF invoice** uses a Latin font.

## Hardware suggestions

- **KDS:** a 10–15″ Android tablet or a small PC with a monitor, running Chrome in kiosk or full-screen mode.
- **POS:** any Windows, ChromeOS or macOS computer, or a 10″+ Android tablet. A cash drawer plugs into the receipt printer's drawer port. When a POS receipt is printed over USB, Bluetooth or network for a sale that includes cash, the drawer-kick command is sent. With browser printing, enable "open drawer" in the printer driver instead.
- **Waiter:** any smartphone from the last 5 years.

## Known limitations

- **Card payments are recorded, not processed.** The platform records card, cash, bank and wallet payments and verifies uploaded transfer proofs. It does not connect to a card acquirer or online payment gateway, and it never stores card numbers.
- **Subscription billing is manual.** Restaurants pay by transfer and upload proof, and the Super Admin approves it. There is no automatic card charging.
- **Email is optional.** Without SMTP: reminders appear in the app only; password resets need the restaurant owner (staff) or the Super Admin's reset link (owners); reservation reminders are not sent.
- **No SMS or WhatsApp** messaging is included. Marketing exports (opted-in guests only) can be used with your own provider.
- **Voice calls on restrictive networks** need a TURN server (see DEPLOYMENT.md). Without TURN, some mobile-data calls will fail, and guests are offered the fallback phone number and chat.
- **Offline mode:** screens survive short connection drops and resync. The POS does not take sales while the server is unreachable.
- **Fiscal / e-invoicing integrations** (government tax portals such as FBR or ZATCA) are not included. Tax reports and invoice PDFs can be used for manual filing.
- **Single-currency per restaurant.** Each restaurant chooses one currency. The platform supports any ISO currency, and platform reports group amounts by currency without converting them.
- **Languages:** the interface is in English. Menu content, item names and receipts accept any language (UTF-8).
- **Legal texts** are general templates. Have them reviewed for your jurisdiction.
- **Scaling beyond one API instance** requires Redis and sticky sessions for realtime.
