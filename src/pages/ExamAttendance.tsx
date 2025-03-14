
import { Layout } from "@/components/dashboard/Layout";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useEffect } from "react";
import { Save, FileText, Signature, Search, UserCheck, UsersRound, Building } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { Document, Packer, Paragraph, Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell, TextRun } from 'docx';
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Database } from "@/integrations/supabase/types";
import { Input, SignatureInput } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Student = Database['public']['Tables']['students']['Row'];
type ExamWithCenter = Database['public']['Tables']['exams']['Row'] & {
  exam_centers: Database['public']['Tables']['exam_centers']['Row'] | null;
};
type ExamAttendance = Database['public']['Tables']['exam_attendance']['Row'];

const ExamAttendance = () => {
  const [selectedExam, setSelectedExam] = useState<string>("");
  const [selectedCenter, setSelectedCenter] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch exam sessions with center details
  const { data: examSessions = [], isLoading: isLoadingExams } = useQuery({
    queryKey: ['exams'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exams')
        .select(`
          *,
          exam_centers (
            id,
            name,
            code
          )
        `)
        .order('date');
      
      if (error) {
        console.error("Error fetching exams:", error);
        throw error;
      }
      return data as ExamWithCenter[];
    },
  });

  // Get unique centers from exam sessions
  const examCenters = examSessions
    .filter(exam => exam.exam_centers)
    .map(exam => exam.exam_centers)
    .filter((center, index, self) => 
      center && self.findIndex(c => c?.id === center.id) === index
    );

  // Fetch students
  const { data: students = [], isLoading: isLoadingStudents } = useQuery({
    queryKey: ['students'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .order('name');
      
      if (error) {
        console.error("Error fetching students:", error);
        throw error;
      }
      return data;
    },
  });

  // Fetch exam attendance records for selected exam
  const { data: attendanceRecords = [], isLoading: isLoadingAttendance } = useQuery({
    queryKey: ['attendance', selectedExam],
    queryFn: async () => {
      if (!selectedExam) return [];
      const { data, error } = await supabase
        .from('exam_attendance')
        .select('*')
        .eq('exam_id', selectedExam);
      
      if (error) {
        console.error("Error fetching attendance:", error);
        throw error;
      }
      return data;
    },
    enabled: !!selectedExam,
  });

  // Add query for seating arrangements
  const { data: seatingArrangements = [] } = useQuery({
    queryKey: ['seatingArrangements', selectedExam],
    queryFn: async () => {
      if (!selectedExam) return [];
      const { data, error } = await supabase
        .from('seating_arrangements')
        .select(`
          *,
          seating_assignments (
            seat_no,
            student_name,
            reg_no,
            department
          )
        `)
        .eq('exam_id', selectedExam);
      
      if (error) {
        console.error("Error fetching seating arrangements:", error);
        throw error;
      }
      return data;
    },
    enabled: !!selectedExam,
  });

  // Filter exams by center
  useEffect(() => {
    if (selectedCenter && examSessions.length > 0) {
      const centerExams = examSessions.filter(
        exam => exam.exam_centers?.id === selectedCenter
      );
      
      if (centerExams.length > 0 && (!selectedExam || 
          !centerExams.some(exam => exam.id === selectedExam))) {
        setSelectedExam(centerExams[0].id);
      }
    }
  }, [selectedCenter, examSessions, selectedExam]);

  // Add mutation for updating attendance with seating info
  const updateAttendanceMutation = useMutation({
    mutationFn: async ({ studentId, seatNumber }: { studentId: string; seatNumber: string }) => {
      const { data, error } = await supabase
        .from('exam_attendance')
        .upsert([{
          exam_id: selectedExam,
          student_id: studentId,
          seat_number: seatNumber
        }])
        .select();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance', selectedExam] });
      toast({
        title: "Success",
        description: "Attendance and seating updated successfully",
      });
    },
  });

  // Function to find seat number for a student
  const findStudentSeatNumber = (studentId: string) => {
    const student = students.find(s => s.id === studentId);
    if (!student) return null;

    for (const arrangement of seatingArrangements) {
      const assignment = arrangement.seating_assignments?.find(
        assign => assign.reg_no === student.roll_number
      );
      if (assignment) {
        return assignment.seat_no;
      }
    }
    return null;
  };

  // Single implementation of markAttendance with seating information
  const markAttendance = async (studentId: string) => {
    if (!selectedExam) {
      toast({
        title: "Error",
        description: "Please select an exam session first.",
        variant: "destructive",
      });
      return;
    }

    const seatNumber = findStudentSeatNumber(studentId);
    if (!seatNumber) {
      toast({
        title: "Warning",
        description: "No seating assignment found for this student.",
      });
    }

    updateAttendanceMutation.mutate({ 
      studentId,
      seatNumber: seatNumber || 'Not Assigned'
    });
  };

  // Batch mark attendance for all students with seat assignments
  const markAllAttendance = async () => {
    if (!selectedExam) {
      toast({
        title: "Error",
        description: "Please select an exam session first.",
        variant: "destructive",
      });
      return;
    }

    // Get all students with seat assignments
    const studentsWithSeats: { studentId: string, seatNumber: string }[] = [];
    
    students.forEach(student => {
      const seatNumber = findStudentSeatNumber(student.id);
      if (seatNumber) {
        studentsWithSeats.push({
          studentId: student.id,
          seatNumber
        });
      }
    });

    if (studentsWithSeats.length === 0) {
      toast({
        title: "Warning",
        description: "No students have seating assignments for this exam.",
      });
      return;
    }

    // Mark attendance for each student
    const promises = studentsWithSeats.map(({ studentId, seatNumber }) => 
      updateAttendanceMutation.mutateAsync({ studentId, seatNumber })
    );

    Promise.all(promises)
      .then(() => {
        toast({
          title: "Success",
          description: `Marked attendance for ${studentsWithSeats.length} students`,
        });
      })
      .catch(error => {
        toast({
          title: "Error",
          description: "Failed to mark attendance for all students",
          variant: "destructive",
        });
      });
  };

  // Update teacher signature mutation
  const updateTeacherSignatureMutation = useMutation({
    mutationFn: async ({ teacherId, signature }: { teacherId: string; signature: string }) => {
      const { data, error } = await supabase
        .from('teachers')
        .update({ signature })
        .eq('id', teacherId)
        .select();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teachers'] });
      toast({
        title: "Success",
        description: "Teacher signature updated successfully.",
      });
    },
  });

  const addStudentSignature = (studentId: string, signature: string) => {
    updateAttendanceMutation.mutate({ studentId, seatNumber: signature });
  };

  const addTeacherSignature = (teacherId: string, signature: string) => {
    updateTeacherSignatureMutation.mutate({ teacherId, signature });
  };

  const handleSaveAttendance = () => {
    if (!selectedExam) {
      toast({
        title: "Error",
        description: "Please select an exam session first.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Attendance Saved",
      description: "Exam attendance has been recorded successfully.",
    });
  };

  // Add mutation for deleting attendance records
  const deleteAttendanceMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const { error } = await supabase
        .from('exam_attendance')
        .delete()
        .eq('id', recordId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance', selectedExam] });
      toast({
        title: "Success",
        description: "Attendance record removed successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove attendance record",
        variant: "destructive",
      });
    },
  });

  const handleDelete = async (studentId: string) => {
    const record = attendanceRecords.find(r => r.student_id === studentId);
    if (!record) return;
    
    deleteAttendanceMutation.mutate(record.id);
  };

  // Add function to check if student is present
  const isStudentPresent = (studentId: string) => {
    return attendanceRecords.some(record => record.student_id === studentId);
  };

  // Get unique departments from students
  const departments = ["all", ...new Set(students.map(student => student.department || "Unassigned").filter(Boolean))];

  // Mark all students of a specific department present
  const markDepartmentAttendance = async (department: string) => {
    if (!selectedExam) {
      toast({
        title: "Error",
        description: "Please select an exam session first.",
        variant: "destructive",
      });
      return;
    }

    // Get all students from the selected department
    const departmentStudents = students.filter(student => 
      student.department === department
    );

    if (departmentStudents.length === 0) {
      toast({
        title: "Warning",
        description: `No students found in the ${department} department.`,
      });
      return;
    }

    // Mark attendance for each student in the department
    const promises = departmentStudents.map(student => {
      const seatNumber = findStudentSeatNumber(student.id);
      return updateAttendanceMutation.mutateAsync({ 
        studentId: student.id,
        seatNumber: seatNumber || 'Not Assigned'
      });
    });

    Promise.all(promises)
      .then(() => {
        toast({
          title: "Success",
          description: `Marked attendance for ${departmentStudents.length} students in ${department} department`,
        });
      })
      .catch(error => {
        toast({
          title: "Error",
          description: `Failed to mark attendance for ${department} department students`,
          variant: "destructive",
        });
      });
  };

  // Modify generateAttendanceData to include signature information
  const generateAttendanceData = () => {
    const selectedExamSession = examSessions.find((exam) => exam.id === selectedExam);
    if (!selectedExamSession) return null;

    // Group students by department
    const departmentGroups: {[key: string]: any[]} = {};
    
    students.forEach(student => {
      const dept = student.department || "Unassigned";
      if (!departmentGroups[dept]) {
        departmentGroups[dept] = [];
      }
      
      const attendanceRecord = attendanceRecords.find(record => record.student_id === student.id);
      departmentGroups[dept].push({
        regNo: student.roll_number,
        name: student.name,
        signature: student.signature || '_____________',
        isPresent: !!attendanceRecord,
        seatNumber: attendanceRecord?.seat_number || findStudentSeatNumber(student.id) || '-'
      });
    });

    return {
      examSession: selectedExamSession,
      departmentGroups
    };
  };

  // Update downloadAttendanceSheet to include signature column
  const downloadAttendanceSheet = () => {
    const data = generateAttendanceData();
    if (!data) {
      toast({
        title: "Error",
        description: "Please select an exam session first.",
        variant: "destructive",
      });
      return;
    }

    try {
      const wb = XLSX.utils.book_new();
      
      // Add summary sheet
      const summaryData = [
        ['Exam Attendance Report'],
        [],
        ['Center Name:', data.examSession.exam_centers?.name],
        ['Center Code:', data.examSession.exam_centers?.code],
        ['Room:', data.examSession.venue],
        ['Subject:', data.examSession.subject],
        ['Date:', data.examSession.date],
        ['Time:', data.examSession.start_time],
        [],
        ['Department', 'Total Students', 'Present', 'Absent', 'Attendance Rate']
      ];
      
      // Add department summaries
      let totalStudents = 0;
      let totalPresent = 0;
      
      Object.entries(data.departmentGroups).forEach(([dept, students]) => {
        const deptTotal = students.length;
        const deptPresent = students.filter(s => s.isPresent).length;
        const deptAbsent = deptTotal - deptPresent;
        const deptRate = deptTotal > 0 ? Math.round((deptPresent / deptTotal) * 100) : 0;
        
        summaryData.push([
          dept,
          deptTotal.toString(),
          deptPresent.toString(),
          deptAbsent.toString(),
          `${deptRate}%`
        ]);
      });
      
      // Add total row
      const totalAbsent = totalStudents - totalPresent;
      const totalRate = totalStudents > 0 ? Math.round((totalPresent / totalStudents) * 100) : 0;
      
      summaryData.push(
        [],
        ['Total', totalStudents.toString(), totalPresent.toString(), totalAbsent.toString(), `${totalRate}%`]
      );
      
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
      
      // Create department sheets with signature column
      Object.entries(data.departmentGroups).forEach(([dept, students]) => {
        const deptData = [
          [`${dept} Department - Attendance List`],
          [],
          ['Registration No', 'Name', 'Present', 'Seat Number', 'Student Signature'],
          ...students.map(student => [
            student.regNo,
            student.name,
            student.isPresent ? 'Yes' : 'No',
            student.seatNumber,
            student.signature
          ]),
        ];
        
        const deptSheet = XLSX.utils.aoa_to_sheet(deptData);
        XLSX.utils.book_append_sheet(wb, deptSheet, dept.substring(0, 31)); // Excel sheet names limited to 31 chars
      });
      
      XLSX.writeFile(wb, `attendance-${data.examSession.subject}-${data.examSession.date}.xlsx`);

      toast({
        title: "Success",
        description: "Attendance sheet downloaded successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate attendance sheet.",
        variant: "destructive",
      });
    }
  };

  // Update generatePDF to include signature column
  const generatePDF = () => {
    const data = generateAttendanceData();
    if (!data) {
      toast({
        title: "Error",
        description: "Please select an exam session first.",
        variant: "destructive",
      });
      return;
    }

    try {
      const doc = new jsPDF();
      
      doc.setFontSize(16);
      doc.text("Exam Attendance Report", 15, 15);
      
      doc.setFontSize(12);
      doc.text(`Center Name: ${data.examSession.exam_centers?.name}`, 15, 30);
      doc.text(`Center Code: ${data.examSession.exam_centers?.code}`, 15, 37);
      doc.text(`Room: ${data.examSession.venue}`, 15, 44);
      doc.text(`Subject: ${data.examSession.subject}`, 15, 51);
      doc.text(`Date: ${data.examSession.date}`, 15, 58);
      doc.text(`Time: ${data.examSession.start_time}`, 15, 65);
      
      // Add department summary table
      const summaryHeaders = [["Department", "Total", "Present", "Absent", "Rate"]];
      const summaryData: any[] = [];
      
      Object.entries(data.departmentGroups).forEach(([dept, students]) => {
        const deptTotal = students.length;
        const deptPresent = students.filter(s => s.isPresent).length;
        const deptAbsent = deptTotal - deptPresent;
        const deptRate = deptTotal > 0 ? Math.round((deptPresent / deptTotal) * 100) : 0;
        
        summaryData.push([
          dept,
          deptTotal,
          deptPresent,
          deptAbsent,
          `${deptRate}%`
        ]);
      });
      
      (doc as any).autoTable({
        head: summaryHeaders,
        body: summaryData,
        startY: 75,
        styles: { fontSize: 10 },
        headStyles: { fillColor: [41, 128, 185] },
      });
      
      let currentY = (doc as any).lastAutoTable?.finalY + 15 || 150;
      
      // Add department tables with signature column
      Object.entries(data.departmentGroups).forEach(([dept, students]) => {
        // Add page if not enough space
        if (currentY > doc.internal.pageSize.height - 40) {
          doc.addPage();
          currentY = 20;
        }
        
        doc.setFontSize(14);
        doc.text(`${dept} Department`, 15, currentY);
        currentY += 10;
        
        const headers = [["Reg No", "Name", "Present", "Seat Number", "Signature"]];
        
        const tableData = students.map(student => [
          student.regNo,
          student.name,
          student.isPresent ? 'Yes' : 'No',
          student.seatNumber,
          student.signature
        ]);
        
        (doc as any).autoTable({
          head: headers,
          body: tableData,
          startY: currentY,
          styles: { fontSize: 9 },
          headStyles: { fillColor: [41, 128, 185] },
        });
        
        currentY = (doc as any).lastAutoTable?.finalY + 15 || (currentY + 10 + students.length * 10);
      });
      
      // Add signature line on the last page
      doc.text("Teacher Signature: _________________", 15, doc.internal.pageSize.height - 20);

      doc.save(`attendance-${data.examSession.subject}-${data.examSession.date}.pdf`);

      toast({
        title: "Success",
        description: "PDF report generated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate PDF report.",
        variant: "destructive",
      });
    }
  };

  // Update generateWord to include signature column
  const generateWord = async () => {
    const data = generateAttendanceData();
    if (!data) {
      toast({
        title: "Error",
        description: "Please select an exam session first.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Create doc sections for each department
      const sections = [{
        properties: {},
        children: [
          new Paragraph({
            children: [new TextRun({ text: "Exam Attendance Report", bold: true, size: 32 })],
          }),
          new Paragraph({ children: [] }),
          new Paragraph({
            children: [new TextRun({ text: `Center Name: ${data.examSession.exam_centers?.name}` })],
          }),
          new Paragraph({
            children: [new TextRun({ text: `Center Code: ${data.examSession.exam_centers?.code}` })],
          }),
          new Paragraph({
            children: [new TextRun({ text: `Room: ${data.examSession.venue}` })],
          }),
          new Paragraph({
            children: [new TextRun({ text: `Subject: ${data.examSession.subject}` })],
          }),
          new Paragraph({
            children: [new TextRun({ text: `Date: ${data.examSession.date}` })],
          }),
          new Paragraph({
            children: [new TextRun({ text: `Time: ${data.examSession.start_time}` })],
          }),
          new Paragraph({ children: [] }),
          new Paragraph({
            children: [new TextRun({ text: "Department Summary", bold: true, size: 28 })],
          }),
          new Paragraph({ children: [] }),
          new DocxTable({
            rows: [
              new DocxTableRow({
                children: [
                  new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Department", bold: true })] })] }),
                  new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Total", bold: true })] })] }),
                  new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Present", bold: true })] })] }),
                  new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Absent", bold: true })] })] }),
                  new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Rate", bold: true })] })] }),
                ],
              }),
              ...Object.entries(data.departmentGroups).map(([dept, students]) => {
                const deptTotal = students.length;
                const deptPresent = students.filter(s => s.isPresent).length;
                const deptAbsent = deptTotal - deptPresent;
                const deptRate = deptTotal > 0 ? Math.round((deptPresent / deptTotal) * 100) : 0;
                
                return new DocxTableRow({
                  children: [
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: dept })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: deptTotal.toString() })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: deptPresent.toString() })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: deptAbsent.toString() })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${deptRate}%` })] })] }),
                  ],
                });
              })
            ],
          }),
        ],
      }];

      // Add department sections with signature column
      Object.entries(data.departmentGroups).forEach(([dept, students]) => {
        sections.push({
          properties: {},
          children: [
            new Paragraph({ children: [] }),
            new Paragraph({ children: [] }),
            new Paragraph({
              children: [new TextRun({ text: `${dept} Department`, bold: true, size: 28 })],
            }),
            new Paragraph({ children: [] }),
            new DocxTable({
              rows: [
                new DocxTableRow({
                  children: [
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Reg No", bold: true })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Name", bold: true })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Present", bold: true })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Seat Number", bold: true })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Student Signature", bold: true })] })] }),
                  ],
                }),
                ...students.map(student => new DocxTableRow({
                  children: [
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: student.regNo })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: student.name })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: student.isPresent ? 'Yes' : 'No' })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: student.seatNumber })] })] }),
                    new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: student.signature })] })] }),
                  ],
                }))
              ],
            }),
          ],
        });
      });

      // Add signature section
      sections.push({
        properties: {},
        children: [
          new Paragraph({ children: [] }),
          new Paragraph({ children: [] }),
          new Paragraph({
            children: [new TextRun({ text: "Teacher Signature: _____________" })],
          }),
        ],
      });

      const doc = new Document({ sections });
      const blob = await Packer.toBlob(doc);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `attendance-${data.examSession.subject}-${data.examSession.date}.docx`;
      link.click();
      window.URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Word document generated successfully.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to generate Word document.",
        variant: "destructive",
      });
    }
  };

  // Add function to capture student signatures
  const captureStudentSignature = async (studentId: string, signature: string) => {
    try {
      const { error } = await supabase
        .from('students')
        .update({ signature })
        .eq('id', studentId);
      
      if (error) throw error;
      
      queryClient.invalidateQueries({ queryKey: ['students'] });
      
      toast({
        title: "Success",
        description: "Student signature saved successfully",
      });
    } catch (error) {
      console.error("Error saving signature:", error);
      toast({
        title: "Error",
        description: "Failed to save student signature",
        variant: "destructive",
      });
    }
  };

  // Modify the Table component to include SignatureInput for each student
  const renderStudentTable = () => {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[100px]">Reg. No</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Seat</TableHead>
            <TableHead className="w-[120px]">Attendance</TableHead>
            <TableHead>Signature</TableHead>
            <TableHead className="w-[80px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredStudents.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                No students found matching your criteria
              </TableCell>
            </TableRow>
          ) : (
            filteredStudents.map((student) => {
              const isPresent = isStudentPresent(student.id);
              return (
                <TableRow key={student.id}>
                  <TableCell className="font-mono text-xs">{student.roll_number}</TableCell>
                  <TableCell>{student.name}</TableCell>
                  <TableCell>{student.department || "Unassigned"}</TableCell>
                  <TableCell>
                    {attendanceRecords.find(r => r.student_id === student.id)?.seat_number || 
                      findStudentSeatNumber(student.id) || "-"}
                  </TableCell>
                  <TableCell>
                    {isPresent ? (
                      <Badge variant="outline" className="bg-green-100 text-green-800 hover:bg-green-100">Present</Badge>
                    ) : (
                      <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100">Absent</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <SignatureInput 
                      value={student.signature || ""}
                      onChange={(value) => captureStudentSignature(student.id, value)}
                    />
                  </TableCell>
                  <TableCell>
                    {isPresent ? (
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(student.id)}>
                        <span className="sr-only">Remove</span>
                        ×
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => markAttendance(student.id)}>
                        Mark Present
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    );
  };

  // Get filtered students
  const getFilteredStudents = () => {
    return students.filter(student => {
      // Apply search filter
      const matchesSearch = searchQuery === "" || 
        student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.roll_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        student.department?.toLowerCase().includes(searchQuery.toLowerCase());
      
      // Apply department filter
      const matchesDepartment = selectedDepartment === "all" || 
        student.department === selectedDepartment;
      
      // Apply attendance filter
      if (activeTab === "present") {
        return matchesSearch && matchesDepartment && isStudentPresent(student.id);
      } else if (activeTab === "absent") {
        return matchesSearch && matchesDepartment && !isStudentPresent(student.id);
      }
      
      // "all" tab
      return matchesSearch && matchesDepartment;
    });
  };

  const filteredStudents = getFilteredStudents();
  const selectedExamSession = examSessions.find((exam) => exam.id === selectedExam);
  
  // Stats for attendance
  const totalStudents = filteredStudents.length;
  const presentStudents = filteredStudents.filter(student => 
    isStudentPresent(student.id)
  ).length;
  const absentStudents = totalStudents - presentStudents;
  const attendanceRate = totalStudents > 0 ? (presentStudents / totalStudents) * 100 : 0;

  // Department stats
  const departmentStats = departments
    .filter(dept => dept !== "all")
    .map(dept => {
      const deptStudents = students.filter(student => student.department === dept);
      const deptPresent = deptStudents.filter(student => isStudentPresent(student.id)).length;
      return {
        name: dept,
        total: deptStudents.length,
        present: deptPresent,
        absent: deptStudents.length - deptPresent,
        rate: deptStudents.length > 0 ? (deptPresent / deptStudents.length) * 100 : 0
      };
    })
    .filter(dept => dept.total > 0)
    .sort((a, b) => b.total - a.total);

  // Render the UI
  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-4">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            <Select 
              value={selectedCenter} 
              onValueChange={setSelectedCenter}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select Center" />
              </SelectTrigger>
              <SelectContent>
                {examCenters.map((center) => (
                  center && (
                    <SelectItem key={center.id} value={center.id}>
                      {center.name}
                    </SelectItem>
                  )
                ))}
              </SelectContent>
            </Select>
            
            <Select 
              value={selectedExam} 
              onValueChange={setSelectedExam}
              disabled={!selectedCenter}
            >
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Select Exam Session" />
              </SelectTrigger>
              <SelectContent>
                {examSessions
                  .filter(exam => !selectedCenter || exam.exam_centers?.id === selectedCenter)
                  .map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.subject} - {exam.date}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            
            <Select
              value={selectedDepartment}
              onValueChange={setSelectedDepartment}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((dept) => (
                  <SelectItem key={dept} value={dept}>
                    {dept === "all" ? "All Departments" : dept}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={markAllAttendance}>
              <UserCheck className="mr-1 h-4 w-4" />
              Mark All Present
            </Button>
            
            {selectedDepartment !== "all" && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => markDepartmentAttendance(selectedDepartment)}
              >
                <Building className="mr-1 h-4 w-4" />
                Mark Department
              </Button>
            )}
            
            <Button variant="default" size="sm" onClick={handleSaveAttendance}>
              <Save className="mr-1 h-4 w-4" />
              Save
            </Button>
          </div>
        </div>
        
        {selectedExam && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl">
                {selectedExamSession?.subject} - {selectedExamSession?.date}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <div className="text-sm font-medium mb-1">Total Students</div>
                  <div className="text-2xl font-bold">{totalStudents}</div>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Present</div>
                  <div className="text-2xl font-bold text-green-600">{presentStudents}</div>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Absent</div>
                  <div className="text-2xl font-bold text-red-600">{absentStudents}</div>
                </div>
                <div>
                  <div className="text-sm font-medium mb-1">Attendance Rate</div>
                  <div className="text-2xl font-bold">{attendanceRate.toFixed(1)}%</div>
                </div>
              </div>
              
              <div className="flex items-center space-x-2 mb-4">
                <div className="relative w-full">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"/>
                  <Input
                    type="search"
                    placeholder="Search by name, reg no, or department..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={downloadAttendanceSheet}>
                    <FileText className="mr-1 h-4 w-4" />
                    Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={generatePDF}>
                    <FileText className="mr-1 h-4 w-4" />
                    PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={generateWord}>
                    <FileText className="mr-1 h-4 w-4" />
                    Word
                  </Button>
                </div>
              </div>
              
              <Tabs defaultValue="all" value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-4">
                  <TabsTrigger value="all">All Students</TabsTrigger>
                  <TabsTrigger value="present">Present</TabsTrigger>
                  <TabsTrigger value="absent">Absent</TabsTrigger>
                </TabsList>
                
                <TabsContent value="all" className="mt-0">
                  {renderStudentTable()}
                </TabsContent>
                
                <TabsContent value="present" className="mt-0">
                  {renderStudentTable()}
                </TabsContent>
                
                <TabsContent value="absent" className="mt-0">
                  {renderStudentTable()}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
};

export default ExamAttendance;
