let selectedFile = null;

// Initialize drag and drop
function initializeDragAndDrop() {
    const dropArea = document.getElementById('dropArea');
    const fileInput = document.getElementById('fileInput');

    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });

    // Highlight drop area when item is dragged over it
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, unhighlight, false);
    });

    // Handle dropped files
    dropArea.addEventListener('drop', handleDrop, false);

    // Handle click to select file
    dropArea.addEventListener('click', () => {
        fileInput.click();
    });

    // Handle file selection via click
    fileInput.addEventListener('change', function() {
        if (this.files && this.files.length > 0) {
            handleFiles(this.files);
        }
    });
}

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function highlight(e) {
    document.getElementById('dropArea').classList.add('dragover');
}

function unhighlight(e) {
    document.getElementById('dropArea').classList.remove('dragover');
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files);
}

function handleFiles(files) {
    if (files.length > 0) {
        const file = files[0];
        
        // Check if it's a CSV file
        if (!file.name.toLowerCase().endsWith('.csv')) {
            showStatus('Please select a CSV file', 'error');
            return;
        }
        
        selectedFile = file;
        showFileInfo(file);
        document.getElementById('importBtn').disabled = false;
    }
}

function showFileInfo(file) {
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    
    fileName.textContent = file.name;
    fileSize.textContent = `Size: ${(file.size / 1024).toFixed(1)} KB`;
    fileInfo.style.display = 'block';
}

function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
    status.style.display = 'block';
}

function hideStatus() {
    const status = document.getElementById('status');
    status.style.display = 'none';
}

async function importCSV() {
    if (!selectedFile) {
        showStatus('Please select a CSV file first', 'error');
        return;
    }

    console.log('Importing file:', selectedFile.name);

    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const csvContent = e.target.result;
            console.log('CSV content length:', csvContent.length);

            const lines = csvContent.split('\n');
            console.log('Total lines:', lines.length);

            // Skip header line
            if (lines.length < 2) {
                showStatus('Invalid CSV file format - file must have at least 2 lines', 'error');
                return;
            }

            // Get existing history from background script
            browser.runtime.sendMessage({ action: 'getVideoHistory' }, function(response) {
                if (browser.runtime.lastError) {
                    showStatus('Error accessing storage: ' + browser.runtime.lastError.message, 'error');
                    return;
                }

                let videoWatchHistory = response.videoWatchHistory || {};
                let importCount = 0;

                // Process each line (skip header)
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const values = line.split(',');
                    if (values.length < 3) continue;

                    const date = values[0].trim();
                    const durationWatched = parseFloat(values[1]);
                    const actualTimeWatched = parseFloat(values[2]);

                    // Validate data
                    if (isNaN(durationWatched) || isNaN(actualTimeWatched) || !date.match(/^\d{4}-\d{2}-\d{2}$/)) {
                        console.log('Skipping invalid data:', { date, durationWatched, actualTimeWatched });
                        continue;
                    }

                    // Update or create entry
                    if (!videoWatchHistory[date]) {
                        videoWatchHistory[date] = {
                            durationWatched: 0,
                            actualTimeWatched: 0
                        };
                    }

                    // Add imported values to existing values
                    videoWatchHistory[date].durationWatched += durationWatched;
                    videoWatchHistory[date].actualTimeWatched += actualTimeWatched;
                    importCount++;
                }

                console.log(`Imported ${importCount} records`);

                // Save updated history via background script
                browser.runtime.sendMessage({ 
                    action: 'setVideoHistory', 
                    data: videoWatchHistory 
                }, function(response) {
                    if (browser.runtime.lastError) {
                        showStatus('Error saving data: ' + browser.runtime.lastError.message, 'error');
                    } else {
                        showStatus(`Successfully imported ${importCount} records!`, 'success');
                        // Disable import button after successful import
                        document.getElementById('importBtn').disabled = true;
                        
                        // Close tab after 2 seconds
                        setTimeout(() => {
                            window.close();
                        }, 2000);
                    }
                });
            });
        } catch (error) {
            console.error('Import error:', error);
            showStatus('Error importing data: ' + error.message, 'error');
        }
    };

    reader.onerror = function(e) {
        console.error('File reading error:', e);
        showStatus('Error reading file', 'error');
    };

    reader.readAsText(selectedFile);
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    initializeDragAndDrop();

    document.getElementById('importBtn').addEventListener('click', importCSV);
    
    document.getElementById('cancelBtn').addEventListener('click', function() {
        window.close();
    });
});