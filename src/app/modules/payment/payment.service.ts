/* eslint-disable @typescript-eslint/no-explicit-any */
import httpStatus from "http-status-codes";
import { uploadBufferToCloudinary } from "../../config/cloudinary.config";
import AppError from "../../errorHelpers/AppError";
import { generatePdf } from "../../utils/invoice";
import { sendEmail } from "../../utils/sendEmail";
import { Booking } from "../booking/booking.model";
import { Payment } from "./payment.model";
import { SSLService } from "../sslCommerz/sslCommerz.service";

// =========================
// PAYMENT SERVICE
// =========================

const initPayment = async (bookingId: string) => {
    const payment = await Payment.findOne({ booking: bookingId });

    if (!payment) {
        throw new AppError(httpStatus.NOT_FOUND, "Payment Not Found. You have not booked this tour");
    }

    const booking = await Booking.findById(payment.booking).populate("user", "name email phone address");

    const user = booking?.user as any;
    if (!user) throw new AppError(httpStatus.BAD_REQUEST, "User not found");

    const sslPayload = {
        address: user.address?.trim(),
        email: user.email?.trim(),
        phoneNumber: user.phone?.trim(),
        name: user.name?.trim(),
        amount: payment.amount,
        transactionId: payment.transactionId
    };

    const sslPayment = await SSLService.sslPaymentInit(sslPayload);

    if (!sslPayment?.GatewayPageURL) {
        throw new AppError(httpStatus.BAD_REQUEST, "Payment URL not generated");
    }

    return { paymentUrl: sslPayment.GatewayPageURL };
};

const successPayment = async (transactionId: string) => {
    const session = await Booking.startSession();
    session.startTransaction();

    try {
        const payment = await Payment.findOneAndUpdate(
            { transactionId },
            { status: "PAID" },
            { new: true, runValidators: true, session }
        );

        if (!payment) throw new AppError(httpStatus.NOT_FOUND, "Payment not found");

        const booking = await Booking.findByIdAndUpdate(
            payment.booking,
            { status: "COMPLETE" },
            { new: true, runValidators: true, session }
        ).populate("tour", "title").populate("user", "name email");

        if (!booking) throw new AppError(httpStatus.NOT_FOUND, "Booking not found");

        // Generate Invoice PDF
        const invoiceData = {
            bookingDate: booking.createdAt,
            guestCount: booking.guestCount,
            totalAmount: payment.amount,
            tourTitle: (booking.tour as any)?.title,
            transactionId: payment.transactionId,
            userName: (booking.user as any)?.name
        };

        const pdfBuffer = await generatePdf(invoiceData);
        const cloudResult = await uploadBufferToCloudinary(pdfBuffer, "invoice");

        if (!cloudResult?.secure_url) throw new AppError(500, "Error uploading invoice");

        // Save invoice URL
        await Payment.findByIdAndUpdate(payment._id, { invoiceUrl: cloudResult.secure_url }, { runValidators: true, session });

        // Send email with invoice
        await sendEmail({
            to: (booking.user as any).email,
            subject: "Your Booking Invoice",
            templateName: "invoice",
            templateData: invoiceData,
            attachments: [
                { filename: "invoice.pdf", content: pdfBuffer, contentType: "application/pdf" }
            ]
        });

        await session.commitTransaction();
        session.endSession();

        return { success: true, message: "Payment Completed Successfully" };
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
};

const failPayment = async (transactionId: string) => {
    const session = await Booking.startSession();
    session.startTransaction();

    try {
        const payment = await Payment.findOneAndUpdate(
            { transactionId },
            { status: "FAILED" },
            { new: true, runValidators: true, session }
        );

        if (payment) {
            await Booking.findByIdAndUpdate(payment.booking, { status: "FAILED" }, { runValidators: true, session });
        }

        await session.commitTransaction();
        session.endSession();
        return { success: false, message: "Payment Failed" };
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
};

const cancelPayment = async (transactionId: string) => {
    const session = await Booking.startSession();
    session.startTransaction();

    try {
        const payment = await Payment.findOneAndUpdate(
            { transactionId },
            { status: "CANCELLED" },
            { new: true, runValidators: true, session }
        );

        if (payment) {
            await Booking.findByIdAndUpdate(payment.booking, { status: "CANCEL" }, { runValidators: true, session });
        }

        await session.commitTransaction();
        session.endSession();
        return { success: false, message: "Payment Cancelled" };
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        throw error;
    }
};

const getInvoiceDownloadUrl = async (paymentId: string) => {
    const payment = await Payment.findById(paymentId).select("invoiceUrl");

    if (!payment) throw new AppError(404, "Payment not found");
    if (!payment.invoiceUrl) throw new AppError(404, "No invoice found");

    return payment.invoiceUrl;
};

export const PaymentService = {
    initPayment,
    successPayment,
    failPayment,
    cancelPayment,
    getInvoiceDownloadUrl
};
