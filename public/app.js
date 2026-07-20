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
const successTitle = document.getElementById('successTitle');
const successDetails = document.getElementById('successDetails');
const successOverview = document.getElementById('successOverview');
const successPaymentHint = document.getElementById('successPaymentHint');
const successVisitNote = document.getElementById('successVisitNote');
const stripeButton = document.getElementById('stripeCheckoutButton');
const calendarButton = document.getElementById('calendarButton');
const shareButton = document.getElementById('shareButton');
const whatsappShareButton = document.getElementById('whatsappShareButton');
const errorMessage = document.getElementById('errorMessage');
const dayRateMessage = document.getElementById('dayRateMessage');
const boardOccupancyHint = document.getElementById('boardOccupancyHint');
const durationButtons = document.querySelectorAll('.duration-btn');
const fixedDurationButtons = document.querySelectorAll('[data-duration-minutes]');
const customDurationButton = document.querySelector('[data-duration-custom]');
const customTimeField = document.getElementById('customTimeField');

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
const BUSINESS_NAME = 'Malibu SUP Kressbronn';
const BUSINESS_ADDRESS = 'Uferweg 2, 88079 Kressbronn';
const CALENDAR_TIME_ZONE = 'Europe/Berlin';
let boardItemId = 0;
let selectedFixedDurationMinutes = null;
let lastCompletedBooking = null;

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

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function formatMoney(amount) {
    return Number.parseFloat(amount || 0).toLocaleString('de-DE', {
        style: 'currency',
        currency: 'EUR'
    });
}

function formatBookingDate(value) {
    return new Date(value).toLocaleDateString('de-DE', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });
}

function formatBookingTime(value) {
    return new Date(value).toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getPaymentLabel(paymentMethod) {
    if (paymentMethod === 'stripe') {
        return 'Stripe';
    }

    return paymentMethod === 'paypal' ? 'PayPal' : 'Barzahlung';
}

function getPaymentStatusText(booking = {}) {
    if (booking.paymentVerified || booking.stripePaymentStatus === 'paid' || booking.stripePaymentStatus === 'no_payment_required') {
        return 'Online bezahlt';
    }

    return 'Zahlung offen';
}

function formatBoardItemsForDisplay(boardItems = []) {
    return boardItems.map(item => {
        const boardConfig = BOARD_OCCUPANCY_RULES[item.boardType];
        const label = boardConfig?.label || 'Board';
        const people = Number.parseInt(item.peoplePerBoard, 10) || 1;
        return `${label} (${people} Pers.)`;
    }).join(', ');
}

function getBookingShareText(booking) {
    const amount = formatMoney(booking.price);
    const paymentText = booking.paymentVerified || booking.stripePaymentStatus === 'paid' || booking.stripePaymentStatus === 'no_payment_required'
        ? `Zahlung: ${amount} online bezahlt.`
        : `Zahlung: ${amount} noch nicht abgeschlossen.`;

    return [
        `${BUSINESS_NAME}`,
        booking.name ? `Reserviert für: ${booking.name}` : null,
        `${formatBookingDate(booking.startTime)}, ${formatBookingTime(booking.startTime)}-${formatBookingTime(booking.endTime)} Uhr`,
        `Adresse: ${BUSINESS_ADDRESS}`,
        `Boards: ${formatBoardItemsForDisplay(booking.boardItems)}`,
        `Personen: ${getBookingSummary(booking.boardItems).people}`,
        `Betrag: ${amount}`,
        paymentText,
        'Wir freuen uns auf den Besuch am Bodensee.'
    ].filter(Boolean).join('\n');
}

function escapeIcsText(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}

function formatIcsUtcDate(value) {
    return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatIcsLocalDateTime(value) {
    const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (match) {
        return `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6] || '00'}`;
    }

    const date = new Date(value);
    return [
        date.getFullYear().toString().padStart(4, '0'),
        (date.getMonth() + 1).toString().padStart(2, '0'),
        date.getDate().toString().padStart(2, '0'),
        'T',
        date.getHours().toString().padStart(2, '0'),
        date.getMinutes().toString().padStart(2, '0'),
        date.getSeconds().toString().padStart(2, '0')
    ].join('');
}

function createCalendarContent(booking) {
    const description = getBookingShareText(booking);
    const uid = `${booking.id || Date.now()}@malibu-sup-kressbronn`;

    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Malibu SUP Kressbronn//Buchung//DE',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${escapeIcsText(uid)}`,
        `DTSTAMP:${formatIcsUtcDate(new Date())}`,
        `DTSTART;TZID=${CALENDAR_TIME_ZONE}:${formatIcsLocalDateTime(booking.startTime)}`,
        `DTEND;TZID=${CALENDAR_TIME_ZONE}:${formatIcsLocalDateTime(booking.endTime)}`,
        `SUMMARY:${escapeIcsText(`SUP bei ${BUSINESS_NAME}`)}`,
        `LOCATION:${escapeIcsText(`${BUSINESS_NAME}, ${BUSINESS_ADDRESS}`)}`,
        `DESCRIPTION:${escapeIcsText(description)}`,
        'END:VEVENT',
        'END:VCALENDAR'
    ].join('\r\n');
}

function downloadCalendarEntry(booking) {
    const blob = new Blob([createCalendarContent(booking)], {
        type: 'text/calendar;charset=utf-8'
    });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = 'malibu-sup-buchung.ics';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
}

function flashButtonText(button, text) {
    const originalText = button.textContent;
    button.textContent = text;
    setTimeout(() => {
        if (button.isConnected) {
            button.textContent = originalText;
        }
    }, 1800);
}

async function shareBooking(booking, button = null) {
    const text = getBookingShareText(booking);

    if (navigator.share) {
        await navigator.share({
            title: 'Meine SUP-Buchung',
            text
        });
        return;
    }

    if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        if (button) {
            flashButtonText(button, 'Kopiert');
        }
    }
}

function setSuccessActionVisibility({ stripe = false, finalActions = false } = {}) {
    stripeButton.classList.toggle('hidden', !stripe);
    calendarButton.classList.toggle('hidden', !finalActions);
    shareButton.classList.toggle('hidden', !finalActions);
    whatsappShareButton.classList.toggle('hidden', !finalActions);
}

function renderBookingOverview(booking) {
    const summary = getBookingSummary(booking.boardItems);
    const amount = formatMoney(booking.price);
    const paymentLabel = getPaymentStatusText(booking);
    const paymentHtml = booking.paymentVerified || booking.stripePaymentStatus === 'paid' || booking.stripePaymentStatus === 'no_payment_required'
        ? `
            <strong>Zahlung eingegangen:</strong>
            ${escapeHtml(amount)} wurde online per ${escapeHtml(getPaymentLabel(booking.paymentMethod))} bezahlt. Deine Reservierung ist bestätigt.
        `
        : `
            <strong>Zahlung noch offen:</strong>
            Bitte schließe die Online-Zahlung ab, damit deine Reservierung bestätigt wird.
        `;

    successOverview.innerHTML = `
        <div class="success-overview-grid">
            <div>
                <span>Datum</span>
                <strong>${escapeHtml(formatBookingDate(booking.startTime))}</strong>
            </div>
            <div>
                <span>Zeitraum</span>
                <strong>${escapeHtml(formatBookingTime(booking.startTime))}-${escapeHtml(formatBookingTime(booking.endTime))} Uhr</strong>
            </div>
            <div>
                <span>Boards</span>
                <strong>${escapeHtml(String(summary.boards))}</strong>
            </div>
            <div>
                <span>Personen</span>
                <strong>${escapeHtml(String(summary.people))}</strong>
            </div>
            <div>
                <span>Betrag</span>
                <strong>${escapeHtml(amount)}</strong>
            </div>
            <div>
                <span>Zahlung</span>
                <strong>${escapeHtml(paymentLabel)}</strong>
            </div>
        </div>
        <div class="success-detail-row">
            <span>Auswahl</span>
            <strong>${escapeHtml(formatBoardItemsForDisplay(booking.boardItems))}</strong>
        </div>
        ${booking.name ? `
            <div class="success-detail-row">
                <span>Reserviert für</span>
                <strong>${escapeHtml(booking.name)}</strong>
            </div>
        ` : ''}
        <div class="success-detail-row">
            <span>Adresse</span>
            <strong>${escapeHtml(BUSINESS_ADDRESS)}</strong>
        </div>
    `;
    successPaymentHint.innerHTML = paymentHtml;
    successOverview.classList.remove('hidden');
    successPaymentHint.classList.remove('hidden');
    successVisitNote.classList.remove('hidden');
}

function revealFinalSuccess(booking, { checkoutUrl = null } = {}) {
    const isPaid = booking.paymentVerified || booking.stripePaymentStatus === 'paid' || booking.stripePaymentStatus === 'no_payment_required';
    renderBookingOverview(booking);
    setSuccessActionVisibility({ stripe: Boolean(checkoutUrl) && !isPaid, finalActions: isPaid });

    if (checkoutUrl) {
        stripeButton.href = checkoutUrl;
    }

    successTitle.textContent = isPaid ? 'Buchung bezahlt' : 'Zahlung noch offen';
    successDetails.textContent = isPaid
        ? 'Deine Zahlung ist eingegangen. Unten findest du alle Details zum Merken und Teilen.'
        : 'Deine Reservierung ist angelegt, aber die Zahlung wurde noch nicht bestätigt.';

    const shareText = getBookingShareText(booking);
    whatsappShareButton.href = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
    calendarButton.onclick = () => downloadCalendarEntry(booking);
    shareButton.onclick = () => {
        shareBooking(booking, shareButton).catch(error => {
            console.error('Share error:', error);
        });
    };
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
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
    submitBtn.textContent = 'Weiter zu Stripe...';

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
            paymentMethod: 'stripe'
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

        if (!data.booking?.stripeCheckoutUrl) {
            throw new Error('Stripe Checkout konnte nicht gestartet werden.');
        }

        window.location.href = data.booking.stripeCheckoutUrl;
    } catch (error) {
        console.error('Booking error:', error);
        showErrorMessage(error.message || 'Ein Fehler ist aufgetreten. Bitte versuche es erneut.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reservieren & bezahlen';
    }
});

function showSuccessMessage(booking, { checkoutUrl = null } = {}) {
    lastCompletedBooking = {
        ...booking,
        paymentMethod: booking.paymentMethod || 'stripe'
    };
    stripeButton.onclick = null;
    calendarButton.onclick = null;
    shareButton.onclick = null;
    whatsappShareButton.href = '#';

    revealFinalSuccess(lastCompletedBooking, { checkoutUrl });

    successMessage.classList.remove('hidden');
    form.reset();
    resetBookingUi();

    successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function cleanStripeReturnParams() {
    const url = new URL(window.location.href);
    ['stripe_session_id', 'payment_cancelled', 'booking_id'].forEach(key => {
        url.searchParams.delete(key);
    });
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

async function handleStripeReturn() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('stripe_session_id');
    const paymentCancelled = params.get('payment_cancelled');

    if (paymentCancelled) {
        showErrorMessage('Die Zahlung wurde abgebrochen. Deine Reservierung ist erst bestätigt, wenn die Online-Zahlung abgeschlossen ist.');
        cleanStripeReturnParams();
        return;
    }

    if (!sessionId) {
        return;
    }

    successMessage.classList.add('hidden');
    errorMessage.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Zahlung wird geprüft...';

    try {
        const response = await fetch(`/api/stripe/checkout-session/${encodeURIComponent(sessionId)}`);
        const data = await response.json();

        if (!response.ok || data?.success !== true) {
            throw new Error(data?.error || 'Die Zahlung konnte nicht geprüft werden.');
        }

        const isPaid = data.booking?.paymentVerified ||
            data.paymentStatus === 'paid' ||
            data.paymentStatus === 'no_payment_required';
        showSuccessMessage(data.booking, {
            checkoutUrl: isPaid ? null : data.checkoutUrl
        });
        cleanStripeReturnParams();
    } catch (error) {
        console.error('Stripe return error:', error);
        showErrorMessage(error.message || 'Die Zahlung konnte nicht geprüft werden.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Reservieren & bezahlen';
    }
}

function showErrorMessage(message) {
    document.getElementById('errorDetails').textContent = message;
    errorMessage.classList.remove('hidden');
    errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

updateDurationButtons();
handleStripeReturn();
