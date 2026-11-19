# Privacy — what Glane records

By default audio stays on your device. Segments detected as speech are excluded from the library and are not uploaded. You can change this voice policy in the app ([/privacy](https://glane.tadaaa.space/privacy)): *Exclude*, *Mark, keep local* or *Keep*. The recording indicator always stays visible while capturing.

## Stored on your device only

- Captures, sounds, analyses, projects and arrangements — in your browser (IndexedDB and OPFS).
- Your preferences, including the Claude connector token.

## Sent to a server only when you choose

| Action | What is sent | Where |
|--------|--------------|-------|
| Create an account / sign in | Username and password (password stored hashed) | Glane API (`glane-api.tadaaa.space`) |
| Publish a listen link | The exported MP3 mix and its title; link is *unlisted* or *private*, can expire | Glane API |
| Publish to SoundCloud | The exported mix, via your SoundCloud authorization | SoundCloud |
| Use the Claude connector | Tool calls and their answers (library descriptors, arrangement) pass through the relay; the relay stores nothing | Glane relay → the MCP client you connected (e.g. Claude) |

## Downloads

Some on-device ML models (for example stem separation) are downloaded from Hugging Face the first time you use them; your audio is processed locally and is not sent with these downloads.

## No tracking

The app has no analytics or advertising trackers.

## Contact

Privacy requests (access, deletion of an account or a listen link): app@tadaaa.space. The publisher and hosting provider are named in the [legal notice](https://app.tadaaa.space/legal/mentions).

See also: [About](https://glane.tadaaa.space/about.md) · [Contact](https://glane.tadaaa.space/contact.md)
