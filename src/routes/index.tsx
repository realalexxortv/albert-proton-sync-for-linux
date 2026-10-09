import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:py-16">
      <p className="text-xs font-semibold tracking-widest text-muted uppercase">Proton Drive · Linux</p>
      <h1 className="font-display text-5xl leading-none font-semibold">Lane</h1>
      <p className="text-lg text-ink">
        A background program for your Linux machine. Files you put in one folder upload to Proton Drive
        after the folder sits still. Copy mode never deletes anything already on Drive.
      </p>
      <p className="text-muted">
        There is no browser sync. The installer places Lane in your home directory, downloads rclone if you
        do not already have it, signs you into Proton through rclone, and starts a user service.
      </p>
      <a
        className="inline-flex h-11 items-center self-start rounded-full bg-signal px-5 font-semibold text-paper"
        href="/lane-linux.tar.gz"
        download="lane-linux.tar.gz"
      >
        Download for Linux
      </a>
      <ol className="flex list-decimal flex-col gap-3 pl-5 text-ink">
        <li>Unpack the archive.</li>
        <li>From that folder, run sh install.sh. It asks which folder to watch and opens rclone to sign in to Proton.</li>
        <li>Drop files in the folder. Lane uploads them on its own.</li>
      </ol>
      <p className="text-sm text-muted">
        Logs stay on the machine: <span className="text-ink">journalctl --user -u lane.service -f</span>. To
        keep syncing with nobody logged in, the installer will say if lingering is required.
      </p>
    </main>
  );
}
