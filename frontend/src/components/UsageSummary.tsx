import { UsageSnapshot } from '../@types/usage-control';

export default function UsageSummary({ data }: { data: UsageSnapshot }) {
  return (
    <div>
      <p className="mb-3 text-sm">
        Day: {data.day} · Month: {data.month} · Resets in {data.timezone}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="p-2">Scope</th>
              <th className="p-2">Today / cap</th>
              <th className="p-2">This month / cap</th>
            </tr>
          </thead>
          <tbody>
            {data.scopes.map((row) => (
              <tr key={row.scope} className="border-t border-gray/20">
                <th className="p-2 font-medium">{row.scope}</th>
                <td className="p-2 whitespace-nowrap">
                  {row.day.toLocaleString()} /{' '}
                  {row.dailyRequests?.toLocaleString() ?? 'No cap'}
                </td>
                <td className="p-2 whitespace-nowrap">
                  {row.month.toLocaleString()} /{' '}
                  {row.monthlyRequests?.toLocaleString() ?? 'No cap'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs opacity-70">{data.notice}</p>
    </div>
  );
}
