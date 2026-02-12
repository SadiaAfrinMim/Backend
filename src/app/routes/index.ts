import { Router } from "express"
import { AuthRoutes } from "../modules/auth/auth.route"

import { OtpRoutes } from "../modules/otp/otp.route"
import { PaymentRoutes } from "../modules/payment/payment.route"

import { UserRoutes } from "../modules/user/user.route"

export const router = Router()

const moduleRoutes = [
    {
        path: "/user",
        route: UserRoutes
    },
    {
        path: "/auth",
        route: AuthRoutes
    },
   
    {
        path: "/payment",
        route: PaymentRoutes
    },
    {
        path: "/otp",
        route: OtpRoutes
    },
    
   
]

moduleRoutes.forEach((route) => {
    router.use(route.path, route.route)
})

