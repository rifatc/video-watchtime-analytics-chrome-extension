function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
}

function updatePopup() {
    chrome.storage.local.get(['videoWatchHistory'], function(result) {
        const history = result.videoWatchHistory || {};
        let totalDuration = 0;
        let totalActual = 0;

        const table = document.getElementById('historyTable');

        // Clear existing rows except header
        while (table.rows.length > 1) {
            table.deleteRow(1);
        }

        // Sort dates in descending order
        const sortedDates = Object.keys(history).sort((a, b) => new Date(b) - new Date(a));

        sortedDates.forEach(date => {
            const stats = history[date];
            totalDuration += stats.durationWatched;
            totalActual += stats.actualTimeWatched;

            const row = table.insertRow();
            row.insertCell(0).textContent = date;
            row.insertCell(1).textContent = formatTime(stats.durationWatched);
            row.insertCell(2).textContent = formatTime(stats.actualTimeWatched);
            const timeSaved = stats.durationWatched - stats.actualTimeWatched;
            const timeSavedPercentage = (timeSaved / stats.durationWatched * 100).toFixed(2);
            row.insertCell(3).textContent = `${formatTime(timeSaved)} (${timeSavedPercentage}%)`;
        });

        const timeSaved = totalDuration - totalActual;
        const timeSavedPercentage = (timeSaved / totalDuration * 100).toFixed(2);
        document.getElementById('totalStats').innerHTML = `
            <p>Total Time Watched: ${formatTime(totalDuration)}</p>
            <p>Total Actual Time Watched: ${formatTime(totalActual)}</p>
            <p>Time Saved: ${formatTime(timeSaved)} (${timeSavedPercentage}%)</p>
        `;
    });
}

document.addEventListener('DOMContentLoaded', updatePopup);
