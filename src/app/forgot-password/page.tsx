import Link from 'next/link';
import {requestRecovery} from './actions';
export default async function ForgotPassword({searchParams}:{searchParams:Promise<{notice?:string;error?:string}>}){
 const sp=await searchParams;
 return <main className="auth"><div className="card"><h1>Reset your password</h1><p>Enter your account email to request a recovery link.</p>{sp.notice==='sent' && <p role="status">If an account exists, recovery instructions will be sent. Check your inbox and spam folder.</p>}{sp.error && <p role="alert">Enter a valid email address and try again.</p>}<form action={requestRecovery}><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required/><button className="btn" type="submit">Send recovery link</button></form><p><Link href="/login">Back to sign in</Link></p></div></main>;
}
