<div align="center">

<img src="https://raw.githubusercontent.com/Mnemosyne-OS/Mnemosyne-Neural-OS/main/assets/banner-mnemosyne-os.png" width="100%" alt="Mnemosyne OS — Your memory. Your machine. Your rules." />

🌐 [**mnemosyne-os.io**](https://mnemosyne-os.io) — the product&ensp;·&ensp;[**mnemosyne-os.com**](https://mnemosyne-os.com) — for organizations&ensp;·&ensp;📖 [**docs.mnemosyne-os.io**](https://docs.mnemosyne-os.io) — the documentation

</div>

# MnemoBreach

A Mnemosyne OS cartridge. Check whether a password appears in known data
breaches without sending it, and browse every public breach with its dates and
what leaked.

Answers come from [Have I Been Pwned](https://haveibeenpwned.com) and, for the
free email search, [XposedOrNot](https://xposedornot.com). No breach file is
ever downloaded.

- **Password test**: the password is hashed with SHA-1 on your machine. Only
  the first 5 characters of the hash are sent, and the answer is padded so its
  size reveals nothing.
- **Your identifiers**: your own emails and phone numbers, saved on this
  machine and shown masked. Hold one to see it in clear.
- **Email search**: free through [XposedOrNot](https://xposedornot.com) (dates
  to the year), or with your own Have I Been Pwned key (dates to the day). The
  email goes to the service that answers, and the screen says which first.
- **The catalogue**: every public breach, most recent first. Fake data and spam
  lists are listed apart.

With no key, the free email search needs no permission. Your own HIBP key,
saving results to memory and the background watch each ask for theirs when you
first use them.

Nobody can remove your data from a leak. A service that sells you that is lying.

## Develop

```bash
pnpm --filter @mnemosyne-plugins/mnemo-breach dev
```

The dev server runs on port 5234. Opened in a plain browser, your identifiers
are saved in that browser only, and the screen says so.

Design: `docs/architecture/141_breach-watch-cartridge.md`.

## Where Mnemosyne OS lives

This cartridge runs inside **Mnemosyne OS**, the sovereign, local-first memory operating system published by XPACEGEMS LLC. Its official addresses:

- Product site: <https://mnemosyne-os.io>
- Organizations: <https://mnemosyne-os.com>
- Documentation: <https://docs.mnemosyne-os.io>
- Host source: <https://github.com/Mnemosyne-OS/Mnemosyne-Neural-OS>
- Packages: the npm scope `@mnemosyne_os`

---

<sub>**[Mnemosyne OS](https://mnemosyne-os.io)** — the sovereign, local-first memory OS this cartridge runs in.
Get it at [mnemosyne-os.io/download](https://mnemosyne-os.io/download), install cartridges from the built-in MnemoHub store, or [build your own](https://mnemosyne-os.io/dev).</sub>
