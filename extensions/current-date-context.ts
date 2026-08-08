import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function formatLocalDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export default function currentDateContext(pi: ExtensionAPI) {
	let currentDate = formatLocalDate(new Date());

	pi.on("session_start", () => {
		currentDate = formatLocalDate(new Date());
	});

	pi.on("before_agent_start", (event) => ({
		systemPrompt: `${event.systemPrompt}\n\nCurrent date: ${currentDate}.`,
	}));
}
