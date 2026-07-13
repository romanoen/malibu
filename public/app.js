const form = document.getElementById('bookingForm');
const bookingDateInput = document.getElementById('bookingDate');
const startTimeSelect = document.getElementById('startTime');
const endTimeSelect = document.getElementById('endTime');
const boardItemsContainer = document.getElementById('boardItems');
const addBoardItemBtn = document.getElementById('addBoardItemBtn');
const totalPriceDisplay = document.getElementById('totalPrice');
const summaryPeopleDisplay = document.getElementById('summaryPeople');
const summaryBoardsDisplay = document.getElementById('summaryBoards');
const submitBtn = document.getElementById('submitBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const dayRateMessage = document.getElementById('dayRateMessage');
const boardOccupancyHint = document.getElementById('boardOccupancyHint');
const durationButtons = document.querySelectorAll('.duration-btn');
const fixedDurationButtons = document.querySelectorAll('[data-duration-minutes]');
const customDurationButton = document.querySelector('[data-duration-custom]');
const customTimeField = document.getElementById('customTimeField');
const paymentNote = document.getElementById('paymentNote');
const paymentMethodInputs = document.querySelectorAll('input[name="paymentMethod"]');

const BOOKING_START_HOUR = 8;
const BOOKING_END_HOUR = 20;
const BOOKING_INTERVAL_MINUTES = 15;
const MAX_ONLINE_DURATION_MINUTES = (BOOKING_END_HOUR - BOOKING_START_HOUR) * 60;
const BOARD_OCCUPANCY_RULES = {
    lightweight: { label: 'Leichtgewicht', allowedPeoplePerBoard: [1] },
    allround: { label: 'Allround Damen', allowedPeoplePerBoard: [1] },
    super_allround: { label: 'Super-Allround', allowedPeoplePerBoard: [1, 2] },
    bigboard: { label: 'Bigboard', allowedPeoplePerBoard: [2] }
};
const BOARD_TYPE_OPTIONS = [
    { value: 'lightweight', label: '1 Leichtgewicht' },
    { value: 'allround', label: '2 Allround Damen' },
    { value: 'super_allround', label: '3 Super-Allround' },
    { value: 'bigboard', label: '4 Bigboard' }
];
let boardItemId = 0;
let selectedFixedDurationMinutes = null;

function timeToMinutes(timeString) {
    const [hour, minute] = timeString.split(':').map(Number);
    return hour * 60 + minute;
}

function minutesToTime(totalMinutes) {
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function getBoardOccupancyError(boardType, peoplePerBoard) {
    const boardConfig = BOARD_OCCUPANCY_RULES[boardType];
    if (!boardConfig || peoplePerBoard === null) {
        return null;
    }

    if (boardConfig.allowedPeoplePerBoard.includes(peoplePerBoard)) {
        return null;
    }

    if (boardType === 'bigboard') {
        return 'Bigboards sind ausschließlich für 2 Erwachsene geeignet. Bitte wähle 2 Personen pro Board.';
    }

    return `${boardConfig.label}-Boards können nur mit 1 Person belegt werden. Bitte wähle für 2 Personen ein Super-Allround-Board oder Bigboard.`;
}

function showBoardOccupancyHint(message = '', isError = false) {
    boardOccupancyHint.textContent = message;
    boardOccupancyHint.classList.toggle('hidden', !message);
    boardOccupancyHint.classList.toggle('error', Boolean(message && isError));
}

function getBoardTypeOptions(selectedBoardType = 'allround') {
    return BOARD_TYPE_OPTIONS.map(option => {
        const selected = option.value === selectedBoardType ? ' selected' : '';
        return `<option value="${option.value}"${selected}>${option.label}</option>`;
    }).join('');
}

function createBoardItem(item = {}) {
    const itemId = ++boardItemId;
    const boardType = item.boardType || 'allround';
    const parsedPeoplePerBoard = Number(item.peoplePerBoard);
    const peoplePerBoard = [1, 2].includes(parsedPeoplePerBoard) ? parsedPeoplePerBoard : (boardType === 'bigboard' ? 2 : 1);
    const row = document.createElement('div');
    row.className = 'board-item';
    row.dataset.boardItemId = String(itemId);
    row.innerHTML = `
        <div class="board-item-type">
            <label for="boardType-${itemId}">Kategorie</label>
            <select id="boardType-${itemId}" data-board-item-field="boardType" required>
                ${getBoardTypeOptions(boardType)}
            </select>
        </div>
        <div class="board-item-people" data-board-item-people>
            <label for="peoplePerBoard-${itemId}">Personen</label>
            <select id="peoplePerBoard-${itemId}" data-board-item-field="peoplePerBoard" required>
                <option value="1"${peoplePerBoard === 1 ? ' selected' : ''}>1</option>
                <option value="2"${peoplePerBoard === 2 ? ' selected' : ''}>2</option>
            </select>
        </div>
        <button type="button" class="remove-board-btn" data-remove-board-item aria-label="Board-Zeile entfernen">&times;</button>
    `;

    boardItemsContainer.appendChild(row);
    syncBoardItemPeople(row);
    updateRemoveBoardButtons();
}

function syncBoardItemPeople(row) {
    const boardType = row.querySelector('[data-board-item-field="boardType"]')?.value || 'allround';
    const peopleField = row.querySelector('[data-board-item-people]');
    const peopleSelect = row.querySelector('[data-board-item-field="peoplePerBoard"]');
    const showPeople = ['super_allround', 'bigboard'].includes(boardType);

    row.classList.toggle('board-item-with-people', showPeople);
    peopleField.classList.toggle('hidden', !showPeople);

    if (boardType === 'bigboard') {
        peopleSelect.value = '2';
        peopleSelect.disabled = true;
    } else if (boardType === 'super_allround') {
        peopleSelect.disabled = false;
        if (!['1', '2'].includes(peopleSelect.value)) {
            peopleSelect.value = '1';
        }
    } else {
        peopleSelect.value = '1';
        peopleSelect.disabled = true;
    }
}

function resetBoardItems() {
    boardItemsContainer.innerHTML = '';
    createBoardItem({ boardType: 'allround', peoplePerBoard: 1 });
}

function updateRemoveBoardButtons() {
    const rows = boardItemsContainer.querySelectorAll('.board-item');
    rows.forEach(row => {
        const removeButton = row.querySelector('[data-remove-board-item]');
        if (removeButton) {
            removeButton.disabled = rows.length <= 1;
        }
    });
}

function getBoardItems() {
    return [...boardItemsContainer.querySelectorAll('.board-item')].map(row => {
        const boardType = row.querySelector('[data-board-item-field="boardType"]')?.value || 'allround';
        const peoplePerBoard = parseInt(row.querySelector('[data-board-item-field="peoplePerBoard"]')?.value, 10);

        return {
            boardType,
            quantity: 1,
            peoplePerBoard
        };
    });
}

function getBookingSummary(boardItems = getBoardItems()) {
    return boardItems.reduce((summary, item) => {
        const quantity = Number.parseInt(item.quantity, 10) || 0;
        const peoplePerBoard = Number.parseInt(item.peoplePerBoard, 10) || 0;

        return {
            boards: summary.boards + quantity,
            people: summary.people + (quantity * peoplePerBoard)
        };
    }, { boards: 0, people: 0 });
}

function updateBookingSummary(boardItems = getBoardItems()) {
    const summary = getBookingSummary(boardItems);
    summaryPeopleDisplay.textContent = String(summary.people);
    summaryBoardsDisplay.textContent = String(summary.boards);
}

function getBoardItemsError(boardItems) {
    if (boardItems.length === 0) {
        return 'Bitte füge mindestens ein Board hinzu.';
    }

    for (const [index, item] of boardItems.entries()) {
        if (!Number.isInteger(item.quantity) || item.quantity < 1) {
            return `Board ${index + 1}: Bitte gib eine gültige Anzahl ein.`;
        }

        if (![1, 2].includes(item.peoplePerBoard)) {
            return `Board ${index + 1}: Bitte wähle 1 oder 2 Personen.`;
        }

        const occupancyError = getBoardOccupancyError(item.boardType, item.peoplePerBoard);
        if (occupancyError) {
            return boardItems.length > 1 ? `Board ${index + 1}: ${occupancyError}` : occupancyError;
        }
    }

    return null;
}

function generateTimeOptions({ includeClosingTime = false } = {}) {
    const options = [];
    const firstMinute = BOOKING_START_HOUR * 60;
    const lastMinute = BOOKING_END_HOUR * 60 - (includeClosingTime ? 0 : BOOKING_INTERVAL_MINUTES);

    for (let totalMinutes = firstMinute; totalMinutes <= lastMinute; totalMinutes += BOOKING_INTERVAL_MINUTES) {
        const timeString = minutesToTime(totalMinutes);
        options.push(`<option value="${timeString}">${timeString} Uhr</option>`);
    }

    return options.join('');
}

function buildEndTimeOptions(startTime) {
    if (!startTime) {
        return '<option value="">Bitte wählen</option>' + generateTimeOptions({ includeClosingTime: true });
    }

    const startTotalMinutes = timeToMinutes(startTime);
    let endOptions = '<option value="">Bitte wählen</option>';

    const latestEndMinute = Math.min(
        BOOKING_END_HOUR * 60,
        startTotalMinutes + MAX_ONLINE_DURATION_MINUTES
    );

    for (let totalMinutes = BOOKING_START_HOUR * 60; totalMinutes <= latestEndMinute; totalMinutes += BOOKING_INTERVAL_MINUTES) {
        if (totalMinutes > startTotalMinutes) {
            const timeString = minutesToTime(totalMinutes);
            endOptions += `<option value="${timeString}">${timeString} Uhr</option>`;
        }
    }

    return endOptions;
}

function updateDurationButtons() {
    const startTime = startTimeSelect.value;
    const endTime = endTimeSelect.value;
    const startMinutes = startTime ? timeToMinutes(startTime) : null;
    const endMinutes = endTime ? timeToMinutes(endTime) : null;
    const selectedDuration = startMinutes !== null && endMinutes !== null ? endMinutes - startMinutes : null;
    const isCustomOpen = !customTimeField.classList.contains('hidden');

    fixedDurationButtons.forEach(button => {
        const duration = parseInt(button.dataset.durationMinutes, 10);
        const wouldEndAfterClosing = startMinutes !== null && startMinutes + duration > BOOKING_END_HOUR * 60;
        const wouldExceedOnlineLimit = duration > MAX_ONLINE_DURATION_MINUTES;

        button.disabled = wouldEndAfterClosing || wouldExceedOnlineLimit;
        button.classList.toggle(
            'active',
            !isCustomOpen &&
                !wouldEndAfterClosing &&
                !wouldExceedOnlineLimit &&
                (selectedFixedDurationMinutes === duration || selectedDuration === duration)
        );
    });

    customDurationButton.classList.toggle('active', isCustomOpen);
}

function setEndTimeForDuration(durationMinutes) {
    selectedFixedDurationMinutes = durationMinutes;
    customTimeField.classList.add('hidden');

    if (!startTimeSelect.value) {
        startTimeSelect.focus();
        updateDurationButtons();
        return;
    }

    endTimeSelect.innerHTML = buildEndTimeOptions(startTimeSelect.value);

    const endMinutes = timeToMinutes(startTimeSelect.value) + durationMinutes;
    if (endMinutes > BOOKING_END_HOUR * 60) {
        endTimeSelect.value = '';
        updateDurationButtons();
        calculatePrice();
        return;
    }

    const endTime = minutesToTime(endMinutes);
    if ([...endTimeSelect.options].some(option => option.value === endTime)) {
        endTimeSelect.value = endTime;
        updateDurationButtons();
        calculatePrice();
    }
}

function showCustomTimeField() {
    selectedFixedDurationMinutes = null;
    customTimeField.classList.remove('hidden');

    if (!startTimeSelect.value) {
        startTimeSelect.focus();
        endTimeSelect.value = '';
    } else {
        endTimeSelect.focus();
    }

    updateDurationButtons();
    calculatePrice();
}

function resetBookingUi() {
    totalPriceDisplay.textContent = '0,00 €';
    dayRateMessage.classList.add('hidden');
    paymentNote.classList.add('hidden');
    showBoardOccupancyHint();
    resetBoardItems();
    updateBookingSummary();
    endTimeSelect.innerHTML = buildEndTimeOptions();
    customTimeField.classList.add('hidden');
    selectedFixedDurationMinutes = null;
    updateDurationButtons();
}

startTimeSelect.innerHTML = '<option value="">Bitte wählen</option>' + generateTimeOptions();
endTimeSelect.innerHTML = buildEndTimeOptions();

const today = new Date();
today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
bookingDateInput.min = today.toISOString().slice(0, 10);
bookingDateInput.value = bookingDateInput.value || bookingDateInput.min;
resetBoardItems();
updateBookingSummary();

startTimeSelect.addEventListener('change', () => {
    const previousEndTime = endTimeSelect.value;
    endTimeSelect.innerHTML = buildEndTimeOptions(startTimeSelect.value);

    if ([...endTimeSelect.options].some(option => option.value === previousEndTime)) {
        endTimeSelect.value = previousEndTime;
    }

    if (customTimeField.classList.contains('hidden') && selectedFixedDurationMinutes !== null) {
        setEndTimeForDuration(selectedFixedDurationMinutes);
        return;
    }

    updateDurationButtons();
    calculatePrice();
});

endTimeSelect.addEventListener('change', () => {
    updateDurationButtons();
    calculatePrice();
});

bookingDateInput.addEventListener('change', calculatePrice);
bookingDateInput.addEventListener('input', calculatePrice);

addBoardItemBtn.addEventListener('click', () => {
    createBoardItem();
    calculatePrice();
});

boardItemsContainer.addEventListener('input', (event) => {
    if (event.target.matches('[data-board-item-field]')) {
        calculatePrice();
    }
});

boardItemsContainer.addEventListener('change', (event) => {
    if (event.target.matches('[data-board-item-field]')) {
        const row = event.target.closest('.board-item');
        if (event.target.matches('[data-board-item-field="boardType"]') && row) {
            syncBoardItemPeople(row);
        }
        calculatePrice();
    }
});

boardItemsContainer.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-board-item]');
    if (removeButton) {
        const rows = boardItemsContainer.querySelectorAll('.board-item');
        if (rows.length > 1) {
            removeButton.closest('.board-item')?.remove();
            updateRemoveBoardButtons();
            calculatePrice();
        }
    }
});

fixedDurationButtons.forEach(button => {
    button.addEventListener('click', () => {
        setEndTimeForDuration(parseInt(button.dataset.durationMinutes, 10));
    });
});

customDurationButton.addEventListener('click', showCustomTimeField);

paymentMethodInputs.forEach(input => {
    input.addEventListener('change', () => {
        const selectedPaymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value;
        paymentNote.classList.toggle('hidden', selectedPaymentMethod !== 'cash');
    });
});

async function calculatePrice() {
    const bookingDate = bookingDateInput.value;
    const startTime = startTimeSelect.value;
    const endTime = endTimeSelect.value;
    const boardItems = getBoardItems();
    updateBookingSummary(boardItems);
    const boardItemsError = getBoardItemsError(boardItems);

    if (boardItemsError) {
        totalPriceDisplay.textContent = '0,00 €';
        dayRateMessage.classList.add('hidden');
        showBoardOccupancyHint(boardItemsError, true);
        updateDurationButtons();
        return;
    }

    showBoardOccupancyHint();

    if (!bookingDate || !startTime || !endTime) {
        totalPriceDisplay.textContent = '0,00 €';
        dayRateMessage.classList.add('hidden');
        updateDurationButtons();
        return;
    }

    const startDateTime = `${bookingDate}T${startTime}:00`;
    const endDateTime = `${bookingDate}T${endTime}:00`;

    try {
        const response = await fetch('/api/calculate-price', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                startTime: startDateTime,
                endTime: endDateTime,
                boardItems
            })
        });

        const data = await response.json();
        if (!response.ok) {
            totalPriceDisplay.textContent = '0,00 €';
            dayRateMessage.classList.add('hidden');
            showBoardOccupancyHint(data.error || 'Bitte prüfe Board-Kategorie und Personenanzahl.', true);
            return;
        }

        if (data.price !== undefined) {
            totalPriceDisplay.textContent = `${data.price.toFixed(2)} €`;
            updateDurationButtons();
            dayRateMessage.classList.add('hidden');
            showBoardOccupancyHint();
        }
    } catch (error) {
        console.error('Error calculating price:', error);
    }
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const paymentMethod = formData.get('paymentMethod');
    const boardItems = getBoardItems();
    const boardItemsError = getBoardItemsError(boardItems);
    const privacyCheck = document.getElementById('privacyCheck').checked;
    const safetyCheck = document.getElementById('safetyCheck').checked;
    const liabilityCheck = document.getElementById('liabilityCheck').checked;

    if (boardItemsError) {
        showBoardOccupancyHint(boardItemsError, true);
        showErrorMessage(boardItemsError);
        return;
    }

    if (!privacyCheck || !safetyCheck || !liabilityCheck) {
        showErrorMessage('Bitte akzeptiere Datenschutz, Leitfaden und Haftungsausschluss.');
        return;
    }

    successMessage.classList.add('hidden');
    errorMessage.classList.add('hidden');
    dayRateMessage.classList.add('hidden');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Wird verarbeitet...';

    try {
        const bookingDate = formData.get('bookingDate');
        const startTime = formData.get('startTime');
        const endTime = formData.get('endTime');

        if (!endTime) {
            showErrorMessage('Bitte wähle eine Dauer.');
            return;
        }

        const bookingData = {
            name: formData.get('name'),
            phone: formData.get('phone'),
            boardItems,
            startTime: `${bookingDate}T${startTime}:00`,
            endTime: `${bookingDate}T${endTime}:00`,
            paymentMethod
        };

        const response = await fetch('/api/bookings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(bookingData)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Fehler bei der Buchung');
        }

        if (paymentMethod === 'paypal') {
            if (data.booking.paypalLink) {
                let paypalUrl = data.booking.paypalLink;

                if (paypalUrl.includes('paypal.me')) {
                    if (!paypalUrl.startsWith('http://') && !paypalUrl.startsWith('https://')) {
                        paypalUrl = 'https://' + paypalUrl;
                    }
                    paypalUrl = paypalUrl.replace(/\/$/, '');
                    paypalUrl = `${paypalUrl}/${parseFloat(data.booking.paypalAmount).toFixed(2)}`;
                }

                showSuccessMessage(data.booking, 'paypal', true, paypalUrl);
            } else {
                showSuccessMessage(data.booking, 'paypal', true);
            }
        } else {
            showSuccessMessage(data.booking, 'cash');
        }
    } catch (error) {
        console.error('Booking error:', error);
        showErrorMessage(error.message || 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reservieren';
    }
});

function showSuccessMessage(booking, paymentMethod, needsVerification = false, paypalUrl = null) {
    let details = '';
    const paypalButton = document.getElementById('paypalLinkButton');

    if (paymentMethod === 'cash') {
        details = `Deine Buchung wurde erstellt. Bitte lege ${booking.price.toFixed(2)}€ in bar vor Ort in einen beschrifteten Umschlag und wirf ihn in den passenden, beschrifteten Briefkasten.`;
        paypalButton.style.display = 'none';
        paypalButton.classList.add('hidden');
    } else if (paymentMethod === 'paypal') {
        if (needsVerification) {
            details = `Deine Buchung wurde erstellt. Bitte schließe die Zahlung über PayPal ab (${booking.price.toFixed(2)}€).`;
        } else {
            details = `Deine Buchung wurde erfolgreich abgeschlossen. PayPal-Zahlung: ${booking.price.toFixed(2)}€.`;
        }

        if (paypalUrl) {
            paypalButton.href = paypalUrl;
            paypalButton.style.display = 'inline-flex';
            paypalButton.classList.remove('hidden');
            paypalButton.onclick = null;
        } else {
            paypalButton.style.display = 'none';
            paypalButton.classList.add('hidden');
        }
    } else {
        details = `Deine Buchung wurde erfolgreich abgeschlossen. Zahlung erhalten: ${booking.price.toFixed(2)}€.`;
        paypalButton.style.display = 'none';
        paypalButton.classList.add('hidden');
    }

    document.getElementById('successDetails').textContent = details;
    successMessage.classList.remove('hidden');
    form.reset();
    resetBookingUi();

    successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showErrorMessage(message) {
    document.getElementById('errorDetails').textContent = message;
    errorMessage.classList.remove('hidden');
    errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

updateDurationButtons();
