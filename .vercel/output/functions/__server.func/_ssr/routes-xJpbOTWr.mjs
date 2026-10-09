import { b as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-xJpbOTWr.js
var import_jsx_runtime = require_jsx_runtime();
function Home() {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10 sm:py-16",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-xs font-semibold tracking-widest text-muted uppercase",
				children: "Proton Drive · Linux"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "font-display text-5xl leading-none font-semibold",
				children: "Lane"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-lg text-ink",
				children: "A background program for your Linux machine. Files you put in one folder upload to Proton Drive after the folder sits still. Copy mode never deletes anything already on Drive."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "text-muted",
				children: "There is no browser sync. The installer places Lane in your home directory, downloads rclone if you do not already have it, signs you into Proton through rclone, and starts a user service."
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
				className: "inline-flex h-11 items-center self-start rounded-full bg-signal px-5 font-semibold text-paper",
				href: "/lane-linux.tar.gz",
				download: "lane-linux.tar.gz",
				children: "Download for Linux"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ol", {
				className: "flex list-decimal flex-col gap-3 pl-5 text-ink",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Unpack the archive." }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "From that folder, run sh install.sh. It asks which folder to watch and opens rclone to sign in to Proton." }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: "Drop files in the folder. Lane uploads them on its own." })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "text-sm text-muted",
				children: [
					"Logs stay on the machine: ",
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "text-ink",
						children: "journalctl --user -u lane.service -f"
					}),
					". To keep syncing with nobody logged in, the installer will say if lingering is required."
				]
			})
		]
	});
}
//#endregion
export { Home as component };
