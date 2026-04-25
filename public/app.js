const form = document.getElementById('bookingForm');
const bookingDateInput = document.getElementById('bookingDate');
const startTimeSelect = document.getElementById('startTime');
const endTimeSelect = document.getElementById('endTime');
const numberOfBoardsInput = document.getElementById('numberOfBoards');
const totalPriceDisplay = document.getElementById('totalPrice');
const submitBtn = document.getElementById('submitBtn');
const successMessage = document.getElementById('successMessage');
const errorMessage = document.getElementById('errorMessage');
const dayRateMessage = document.getElementById('dayRateMessage');
const durationButtons = document.querySelectorAll('.duration-btn');
const fixedDurationButtons = document.querySelectorAll('[data-duration-minutes]');
const customDurationButton = document.querySelector('[data-duration-custom]');
const customTimeField = document.getElementById('customTimeField');
const boardStepButtons = document.querySelectorAll('[data-board-step]');
const paymentNote = document.getElementById('paymentNote');
const paymentMethodInputs = document.querySelectorAll('input[name="paymentMethod"]');

const BOOKING_START_HOUR = 8;
const BOOKING_END_HOUR = 20;
const BOOKING_INTERVAL_MINUTES = 15;
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

function getBoardCount() {
    const numberOfBoards = parseInt(numberOfBoardsInput.value, 10);
    return Number.isInteger(numberOfBoards) && numberOfBoards >= 1 ? numberOfBoards : null;
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

    for (let totalMinutes = BOOKING_START_HOUR * 60; totalMinutes <= BOOKING_END_HOUR * 60; totalMinutes += BOOKING_INTERVAL_MINUTES) {
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

        button.disabled = wouldEndAfterClosing;
        button.classList.toggle(
            'active',
            !isCustomOpen &&
                !wouldEndAfterClosing &&
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

[bookingDateInput, numberOfBoardsInput].forEach(input => {
    input.addEventListener('change', calculatePrice);
    input.addEventListener('input', calculatePrice);
});

fixedDurationButtons.forEach(button => {
    button.addEventListener('click', () => {
        setEndTimeForDuration(parseInt(button.dataset.durationMinutes, 10));
    });
});

customDurationButton.addEventListener('click', showCustomTimeField);

boardStepButtons.forEach(button => {
    button.addEventListener('click', () => {
        const step = parseInt(button.dataset.boardStep, 10);
        const currentValue = parseInt(numberOfBoardsInput.value, 10) || 1;
        numberOfBoardsInput.value = Math.max(1, currentValue + step);
        numberOfBoardsInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
});

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
    const numberOfBoards = getBoardCount();

    if (!bookingDate || !startTime || !endTime || numberOfBoards === null) {
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
                numberOfBoards
            })
        });

        const data = await response.json();
        if (data.price !== undefined) {
            totalPriceDisplay.textContent = `${data.price.toFixed(2)} €`;
            updateDurationButtons();

            if (data.isDayRate) {
                const dayRateDetails = document.getElementById('dayRateDetails');
                dayRateDetails.textContent = 'Tagesmiete (24h) wurde aktiviert.';
                dayRateMessage.classList.remove('hidden');
            } else {
                dayRateMessage.classList.add('hidden');
            }
        }
    } catch (error) {
        console.error('Error calculating price:', error);
    }
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(form);
    const paymentMethod = formData.get('paymentMethod');
    const privacyCheck = document.getElementById('privacyCheck').checked;
    const safetyCheck = document.getElementById('safetyCheck').checked;

    if (!privacyCheck || !safetyCheck) {
        showErrorMessage('Bitte akzeptiere Datenschutz und Leitfaden.');
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
            numberOfBoards: parseInt(formData.get('numberOfBoards'), 10),
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
