const ROWS_PER_PAGE = 7; // 7 days per page
let currentPage = 1;
let totalPages = 1;
let paginatedHistory = [];

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

        // Sort dates in descending order
        const sortedDates = Object.keys(history).sort((a, b) => new Date(b) - new Date(a));

        paginatedHistory = sortedDates.map(date => {
            const stats = history[date];
            totalDuration += stats.durationWatched;
            totalActual += stats.actualTimeWatched;
            const timeSaved = stats.durationWatched - stats.actualTimeWatched;
            const timeSavedPercentage = (timeSaved / stats.durationWatched * 100).toFixed(2);
            return {
                date,
                durationWatched: formatTime(stats.durationWatched),
                actualTimeWatched: formatTime(stats.actualTimeWatched),
                timeSaved: `${formatTime(timeSaved)} (${timeSavedPercentage}%)`
            };
        });

        totalPages = Math.ceil(paginatedHistory.length / ROWS_PER_PAGE);
        updateTable();
        updatePaginationControls();

        const timeSaved = totalDuration - totalActual;
        const timeSavedPercentage = (timeSaved / totalDuration * 100).toFixed(2);
        document.getElementById('totalStats').innerHTML = `
            <p>Total Time Watched: ${formatTime(totalDuration)}</p>
            <p>Total Actual Time Watched: ${formatTime(totalActual)}</p>
            <p>Time Saved: ${formatTime(timeSaved)} (${timeSavedPercentage}%)</p>
        `;
    });
}

function updateTable() {
    const table = document.getElementById('historyTable');

    // Clear existing rows except header
    while (table.rows.length > 1) {
        table.deleteRow(1);
    }

    const startIndex = (currentPage - 1) * ROWS_PER_PAGE;
    const endIndex = startIndex + ROWS_PER_PAGE;
    const pageData = paginatedHistory.slice(startIndex, endIndex);

    pageData.forEach(item => {
        const row = table.insertRow();
        row.insertCell(0).textContent = item.date;
        row.insertCell(1).textContent = item.durationWatched;
        row.insertCell(2).textContent = item.actualTimeWatched;
        row.insertCell(3).textContent = item.timeSaved;
    });
}

function updatePaginationControls() {
    const paginationDiv = document.getElementById('pagination');
    paginationDiv.innerHTML = `
        <button id="prevPage" ${currentPage === 1 ? 'disabled' : ''}><<</button>
        <span>Page ${currentPage} of ${totalPages}</span>
        <button id="nextPage" ${currentPage === totalPages ? 'disabled' : ''}>>></button>
    `;

    document.getElementById('prevPage').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            updateTable();
            updatePaginationControls();
        }
    });

    document.getElementById('nextPage').addEventListener('click', () => {
        if (currentPage < totalPages) {
            currentPage++;
            updateTable();
            updatePaginationControls();
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    updatePopup();
    // Add pagination controls to the DOM
    const paginationDiv = document.createElement('div');
    paginationDiv.id = 'pagination';
    document.body.appendChild(paginationDiv);
});
