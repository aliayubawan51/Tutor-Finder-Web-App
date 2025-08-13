import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verify } from "jsonwebtoken";
import { connectToDatabase } from "@/lib/mongodb";
import Assignment from "@/models/Assignment";
import { Teacher } from "@/models/Teacher";
import { Notification } from "@/models/Notification";

interface JwtPayload {
  userId: string;
  role: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; submissionId: string } }
) {
  try {
    // Extract parameters
    const assignmentId = params.id;
    const submissionId = params.submissionId;
    
    console.log(`Processing grade for submission ${submissionId} of assignment ${assignmentId}`);
    
    // Verify authentication
    const cookieStore = cookies();
    const token = cookieStore.get("auth-token")?.value;
    
    if (!token) {
      console.log("No auth token found");
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    
    // Verify token
    let decoded;
    try {
      decoded = verify(token, process.env.JWT_SECRET!) as JwtPayload;
      console.log(`Token verified for user: ${decoded.userId}, role: ${decoded.role}`);
    } catch (e) {
      console.error("Token verification failed:", e);
      return NextResponse.json(
        { success: false, error: "Invalid token" },
        { status: 401 }
      );
    }
    
    // Ensure user is a teacher
    if (decoded.role !== "teacher") {
      console.log("Access denied: user is not a teacher");
      return NextResponse.json(
        { success: false, error: "Access denied - only teachers can grade assignments" },
        { status: 403 }
      );
    }
    
    // Parse request body
    const body = await request.json();
    const { grade, feedback } = body;
    
    // Validate required fields
    if (grade === undefined || !feedback) {
      console.log("Missing required fields. Grade:", grade, "Feedback:", feedback ? "Provided" : "Missing");
      return NextResponse.json(
        { success: false, error: "Grade and feedback are required" },
        { status: 400 }
      );
    }
    
    // Connect to database
    await connectToDatabase();
    console.log("Database connection established");
    
    // Find assignment and verify teacher is the owner
    const assignment = await Assignment.findById(assignmentId);
    
    if (!assignment) {
      console.log("Assignment not found:", assignmentId);
      return NextResponse.json(
        { success: false, error: "Assignment not found" },
        { status: 404 }
      );
    }
    
    const teacherId = decoded.userId;
    
    // Verify teacher is the assignment creator
    if (assignment.teacherId.toString() !== teacherId) {
      console.log("Teacher is not authorized to grade this assignment");
      return NextResponse.json(
        { success: false, error: "Not authorized to grade this assignment" },
        { status: 403 }
      );
    }
    
    // Find the specific submission
    const submission = assignment.submissions.id(submissionId);
    
    if (!submission) {
      console.log("Submission not found:", submissionId);
      return NextResponse.json(
        { success: false, error: "Submission not found" },
        { status: 404 }
      );
    }
    
    // Update the submission with grade and feedback
    submission.grade = grade;
    submission.feedback = feedback;
    submission.status = "graded";
    submission.gradedAt = new Date();
    
    await assignment.save();
    console.log("Assignment updated with grading information");
    
    // Get student information for notification
    const studentId = submission.studentId;
    
    // Get teacher information
    const teacher = await Teacher.findById(teacherId);
    
    if (teacher) {
      const teacherName = `${teacher.firstName} ${teacher.lastName}`;
      
      // Create notification for student
      await Notification.create({
        recipientId: studentId,
        recipientModel: 'Student',
        senderId: teacherId,
        senderModel: 'Teacher',
        type: 'assignment_graded',
        message: `${teacherName} has graded your assignment "${assignment.title}"`,
        relatedDocId: assignment._id,
        read: false
      });
      
      console.log("Student notification created");
    }
    
    return NextResponse.json({
      success: true,
      message: "Submission graded successfully",
      submission
    });
    
  } catch (error) {
    console.error("Error grading submission:", error);
    return NextResponse.json(
      { success: false, error: "Failed to grade submission" },
      { status: 500 }
    );
  }
} 