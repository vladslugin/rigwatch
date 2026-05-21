import { firestoreDB } from "../lib/firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

type DumpRow = {
	name: string;
	was: string;
	unit: string;
};

/**
 * Fetches documents from Firestore collection `masse_und_gewichte` and prints
 * each as "<name> - <was> - <unit>". Returns lines, rows and CSV.
 *
 * If `wasFilter` is "*" (default), returns all documents. Otherwise filters by exact `was` value.
 */
export async function dumpWas(wasFilter: string = "*"): Promise<{ lines: string[]; rows: DumpRow[]; csv: string }> {
	if (!firestoreDB) {
		throw new Error("Firestore is not initialized");
	}

	const colRef = collection(firestoreDB, "masse_und_gewichte");
	const q = wasFilter === "*" ? colRef : query(colRef, where("was", "==", wasFilter));
	const snap = await getDocs(q);

	const rows: DumpRow[] = [];
	snap.forEach((doc) => {
		const d = doc.data() as any;
		rows.push({
			name: d?.name ?? doc.id,
			was: d?.was ?? "",
			unit: d?.unit ?? "",
		});
	});

	rows.sort((a, b) => a.name.localeCompare(b.name, "de"));
	const lines = rows.map((r) => `${r.name} - ${r.was} - ${r.unit}`);

	const csvEscape = (v: unknown): string => {
		const s = String(v ?? "");
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	const csvHeader = "name,was,unit";
	const csvBody = rows.map((r) => [r.name, r.was, r.unit].map(csvEscape).join(",")).join("\n");
	const csv = [csvHeader, csvBody].filter(Boolean).join("\n");

	const output = lines.join("\n");
	if (output) {
		console.log(output);
	} else {
		console.log("No results");
	}

	return { lines, rows, csv };
}

// Expose to browser console for convenience
declare global {
	interface Window {
		dumpWas?: (wasFilter?: string) => Promise<{ lines: string[]; rows: DumpRow[]; csv: string }>;
	}
}

if (typeof window !== "undefined") {
	(window as Window).dumpWas = dumpWas;
	console.log("[Dev] window.dumpWas is available. Usage: await dumpWas('*') or await dumpWas('O2 berechnet')");
}




