'use client';

export function CompletedBatches({
  items,
}: {
  items: {
    id: string;
    name: string;
    projectId: string;
    projectName: string;
    approvedCount: number;
  }[];
}) {
  function download(projectId: string) {
    window.location.href = `/api/projects/${projectId}/export`;
  }
  if (items.length === 0) {
    return <p className="text-sm text-neutral-500">目前無已完成 batch。</p>;
  }
  return (
    <ul className="divide-y divide-neutral-200">
      {items.map((b) => (
        <li key={b.id} className="flex items-center justify-between py-3">
          <div>
            <div className="text-sm font-medium">{b.name}</div>
            <div className="text-xs text-neutral-500">
              {b.projectName} · {b.approvedCount} approved
            </div>
          </div>
          <button
            onClick={() => download(b.projectId)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm"
          >
            下載 project zip
          </button>
        </li>
      ))}
    </ul>
  );
}
