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
