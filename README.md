# Folio

Your cozy, dark, moody ebook library. A real desktop app that lives on your Mac, reads EPUBs, manages metadata, and copies books to your Kobo, Kindle, and Xteink X4.

This is the starter kit. Everything here works out of the box, but it is intentionally a foundation to vibe-code on top of, not a finished product. Claude Code will do the heavy lifting from here.

## What you get on day one

When you run this for the first time you will have:

A working desktop app with the dark reading-den aesthetic. A real SQLite database that stores your library and persists forever. EPUB import with automatic metadata extraction (title, author, publisher, year, cover art, ISBN when present). Metadata editing with title, author, series, tags, reading status, star rating. Filter by reading status. Shelf organization by tag. Live search. Grid and list views. Device configuration for Kobo Libra 2, Kindle Paperwhite, and Xteink X4. USB file transfer to any connected device. Auto-detection when you plug a device in, with a green dot in the sidebar.

What is not wired up yet, which you will build with Claude Code in weekend two and beyond:

Format conversion (EPUB to KEPUB for Kobo, EPUB to MOBI for Kindle). Send-to-Kindle email delivery. Wireless transfer to the Xteink. Cover fetching from Open Library for books that have no embedded cover. Drag-and-drop import. Reading progress sync from the devices.

## Part one: installing the things you need

You only do this part once. After this, running the app is just a double-click.

### Step 1, install Node.js

Node is what runs the app. Go to https://nodejs.org and download the big green button on the left (the LTS version). Open the .pkg file that downloads, click through the installer. When it finishes you have Node. That is the whole step.

### Step 2, install Visual Studio Code

This is where you will do the vibe-coding. Go to https://code.visualstudio.com, download for Mac, drag the app into Applications. Open it once.

### Step 3, install the Claude Code extension inside VS Code

Open VS Code. On the left sidebar there is an icon that looks like four squares (Extensions). Click it. In the search box at the top, type "Claude Code." The official Anthropic one should be the first result. Click Install. Follow the prompt to sign in with your Claude account.

You now have Claude Code sitting inside VS Code, which means you can ask it to change the app in plain English and it will write the code for you.

### Step 4, one terminal moment

Open the Terminal app on your Mac (Cmd+Space, type "terminal"). You need to do this exactly once. In the Terminal, type:

```
cd
```

then press Enter. This puts you in your home folder. Then drag the Folio project folder into the Terminal window. This types the path for you. Press Enter. You should see the prompt change to show you are now inside the folio folder.

Then type:

```
npm install
```

and press Enter. This downloads all the libraries the app needs. It will chatter for a minute or two, maybe show some warnings (those are fine, they always appear), and then stop. That was it. The hardest part is done.

## Part two: running the app

From that same terminal window, type:

```
npm start
```

and press Enter. A window opens. That is Folio running on your machine. Use it. Import an EPUB from your existing library. Click around. Edit some metadata. Close it when you are done.

Next time you want to run it, you do not need to repeat Part one. Just open Terminal, `cd` into the folio folder, and type `npm start` again.

If you want to never touch the terminal again after this, I will show you how to package it into a real .app bundle once you have it the way you want it. See "Packaging" at the bottom.

## Part three: making it yours with Claude Code

This is the fun part. Open the folio folder in VS Code (File → Open Folder). On the left you will see all the project files. On the right or bottom, open the Claude Code chat panel.

Now you can just talk to it. Some examples to try first:

"Look at the books:import handler in src/main/main.js and tell me what it does."

That gives you a sense of how Claude Code reads your project. Then try a real feature:

"When I import an EPUB that has no cover, fetch the cover from Open Library using the ISBN or title and save it alongside the book."

Claude Code will read the relevant files, propose changes, and once you approve, write them. Restart the app (Ctrl+C in the terminal to stop, then npm start again) and test.

Other features that are natural next builds:

"Add a conversion queue. When I send an EPUB to the Kindle, first convert it to MOBI by shelling out to Calibre's ebook-convert command, then copy the MOBI to the device."

"Add a 'Currently reading' widget at the top of the library view that shows my in-progress books with a progress bar."

"Add Send-to-Kindle email support using nodemailer. The SMTP credentials should live in a settings panel."

"Add drag-and-drop file import to the main window."

"Watch the Kobo's reading position files when it is mounted and sync the reading progress back into the local database."

Each of these is a realistic weekend afternoon of work with Claude Code doing the typing.

## Part four: where your data lives

Folio keeps everything locally. On your Mac, the database and all your imported book files live at:

```
~/Library/Application Support/Folio/library/
```

You can back this up by copying that folder. You can also use Time Machine, which will pick it up automatically.

## Configuring your devices

The first time you plug in your Kobo, it mounts at /Volumes/KOBOeReader. Folio detects this automatically and the green dot lights up in the sidebar. Click the device in the sidebar to set the books folder (usually leave it blank to copy to the root), the preferred format, and so on.

For the Xteink X4, plug it in via USB and check in Finder what the volume is called (it varies by firmware version). Use that path in the device config. Wireless support will come later.

For the Kindle, you will want to configure the send-to-Kindle email. You can find yours in the Amazon "Manage your content and devices" page under Preferences → Personal Document Settings.

## Packaging it into a real app

Once you have Folio the way you want it, open Terminal in the folio folder and run:

```
npm run build:mac
```

This produces a Folio.dmg file in a folder called `dist`. You can install that like any Mac app. Drag the icon to Applications and you never have to open the Terminal again. You can delete the project folder if you want, or keep it for future tinkering.

## If something breaks

The most common snag on macOS is a permissions popup the first time you run an unsigned app. If you see "Folio cannot be opened because it is from an unidentified developer," go to System Settings → Privacy & Security, scroll to the bottom, and click "Open Anyway."

If `npm install` fails, it is usually because of Xcode Command Line Tools. Run `xcode-select --install` in Terminal, click through the installer, then try `npm install` again.

If the app opens but shows a blank window, open the Terminal where `npm start` is running and look at the error output. Copy it into Claude Code and ask it what the problem is.

Happy building.
